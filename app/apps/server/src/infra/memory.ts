// In-memory implementations of Cache, Queue, Repository.
// ponytail: single-process, non-durable — fine for the first slice and tests.
// Ceiling: nothing survives a restart and the queue won't scale across processes.
// Upgrade path: Upstash Redis (Cache/Queue) + Postgres (Repository).

import type { AnalysisReport, AuditRecord, CitationRow, ClaimRow, ContentItem, PerspectiveRow } from '../types';
import { projectReportGraph } from '../core/reportGraph';
import type { Cache, Job, JobHandler, Queue, RateLimiter, Repository } from './ports';

export class InMemoryCache implements Cache {
  private store = new Map<string, AnalysisReport>();
  async get(key: string): Promise<AnalysisReport | undefined> {
    return this.store.get(key);
  }
  async set(key: string, report: AnalysisReport): Promise<void> {
    this.store.set(key, report);
  }
}

export class InMemoryQueue implements Queue {
  private handler: JobHandler | undefined;
  async enqueue(job: Job): Promise<void> {
    // Defer so enqueue returns before processing begins (mimics async worker).
    setImmediate(() => {
      void this.handler?.(job).catch((err) => {
        console.error('[queue] job failed:', err);
      });
    });
  }
  process(handler: JobHandler): void {
    this.handler = handler;
  }
}

export class InMemoryRepository implements Repository {
  private contentByHash = new Map<string, ContentItem>();
  private reports = new Map<string, AnalysisReport>();
  // Public so tests can assert persistence without a database (mirrors the
  // disputes/flags table rows). ponytail: append-only, non-durable.
  readonly disputes: { id: string; reportId: string; claimId?: string; reason: string; createdAt: string }[] = [];
  readonly flags: { id: string; reportId: string; userId: string; technique: string; note?: string; createdAt: string }[] = [];
  // Per-report audit log, mirroring the Postgres audit_records table keyed by report_id.
  readonly auditRecords = new Map<string, AuditRecord[]>();
  // Normalized rows from the dual-write, keyed by reportId — mirrors the
  // claims/citations/perspective_links tables. Public so tests can assert the
  // projection without a database. ponytail: replaced wholesale per report.
  readonly claimRows = new Map<string, ClaimRow[]>();
  readonly citationRows = new Map<string, CitationRow[]>();
  readonly perspectiveRows = new Map<string, PerspectiveRow[]>();

  async findContentByHash(hash: string): Promise<ContentItem | undefined> {
    return this.contentByHash.get(hash);
  }
  async saveContent(item: ContentItem): Promise<void> {
    this.contentByHash.set(item.urlHash, item);
  }
  async saveReport(report: AnalysisReport): Promise<void> {
    // JSONB-equivalent write (authoritative render source of truth), as today.
    this.reports.set(report.id, report);
    // Dual-write: replace this report's normalized rows from the same object
    // (idempotent — assign, not append, so re-persisting leaves no stale rows).
    const graph = projectReportGraph(report);
    this.claimRows.set(report.id, graph.claims);
    this.citationRows.set(report.id, graph.citations);
    this.perspectiveRows.set(report.id, graph.perspectives);
  }
  async getReport(id: string): Promise<AnalysisReport | undefined> {
    return this.reports.get(id);
  }

  async getReportBySlug(slug: string): Promise<AnalysisReport | undefined> {
    for (const r of this.reports.values()) {
      if (r.shareSlug === slug) return r;
    }
    return undefined;
  }

  // Backfill support: a report has a graph once its claim rows are populated.
  async hasReportGraph(reportId: string): Promise<boolean> {
    const rows = this.claimRows.get(reportId);
    return rows !== undefined && rows.length > 0;
  }

  // Backfill support: enumerate every persisted report id.
  async listReportIds(): Promise<string[]> {
    return [...this.reports.keys()];
  }

  async createDispute(d: { id: string; reportId: string; claimId?: string; reason: string; createdAt: string }): Promise<void> {
    this.disputes.push(d);
  }

  async createFlag(f: { id: string; reportId: string; userId: string; technique: string; note?: string; createdAt: string }): Promise<void> {
    // Mirror Postgres' UNIQUE (report_id, user_id, technique) idempotency.
    const dup = this.flags.some(
      (x) => x.reportId === f.reportId && x.userId === f.userId && x.technique === f.technique,
    );
    if (!dup) this.flags.push(f);
  }

  // ponytail: append-only in-memory log keyed by reportId — non-durable, dev/test parity.
  async saveAuditRecord(reportId: string, record: AuditRecord): Promise<void> {
    const list = this.auditRecords.get(reportId);
    if (list) list.push(record);
    else this.auditRecords.set(reportId, [record]);
  }
}

// Fixed-window per-key limiter.
// ponytail: the Map isn't actively pruned (expired entries are replaced on next
// access but untouched keys linger). Fine for dev/single-process; the Redis
// limiter is used in production.
export class InMemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, { count: number; expiresAt: number }>();
  constructor(
    private limit: number,
    private windowMs: number = 24 * 60 * 60 * 1000,
  ) {}

  async hit(key: string) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    return {
      allowed: entry.count <= this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      limit: this.limit,
      resetSeconds: Math.ceil((entry.expiresAt - now) / 1000),
    };
  }
}
