// In-memory implementations of Cache, Queue, Repository.
// ponytail: single-process, non-durable — fine for the first slice and tests.
// Ceiling: nothing survives a restart and the queue won't scale across processes.
// Upgrade path: Upstash Redis (Cache/Queue) + Postgres (Repository).

import type { AnalysisReport, AuditRecord, CitationRow, ClaimRow, ContentItem, PerspectiveRow, ResolutionOutcome, ReviewActionResult, ReviewItem, ReviewKind, ReviewLifecycle, ReviewResolutionInput } from '../types';
import { projectReportGraph } from '../core/reportGraph';
import type { Cache, Job, JobHandler, Queue, RateLimiter, Repository } from './ports';

// Parse a Review_Item id "{kind}:{sourceId}" (e.g. "dispute:<uuid>") into its
// parts. Returns null for any malformed id so callers map it to not_found.
// ponytail: split on the FIRST colon only — kind has no colon, sourceId (uuid) has none.
function parseReviewItemId(id: string): { kind: ReviewKind; sourceId: string } | null {
  const sep = id.indexOf(':');
  if (sep <= 0) return null;
  const kind = id.slice(0, sep);
  const sourceId = id.slice(sep + 1);
  if ((kind !== 'dispute' && kind !== 'flag') || sourceId.length === 0) return null;
  return { kind, sourceId };
}

// Base intake row shapes (unchanged intake contract) plus the additive review
// fields stored alongside each Dispute/Flag — mirrors Migration_005's additive
// columns so the existing public accessors expose review state offline (Req 6.4).
type DisputeRow = { id: string; reportId: string; claimId?: string; reason: string; createdAt: string };
type FlagRow = { id: string; reportId: string; userId: string; technique: string; note?: string; createdAt: string };
type ReviewFields = {
  reviewStatus: ReviewLifecycle;
  assignedReviewer: string | null;
  resolution: { outcome: ResolutionOutcome; note?: string; reviewer: string; resolvedAt: string } | null;
};

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
  // disputes/flags table rows, now carrying the additive review-workflow state
  // so review status is readable offline). ponytail: append-only, non-durable.
  readonly disputes: (DisputeRow & ReviewFields)[] = [];
  readonly flags: (FlagRow & ReviewFields)[] = [];
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
    // Req 8.4: a freshly created intake is a pending Review_Item, unassigned, unresolved.
    this.disputes.push({ ...d, reviewStatus: 'pending', assignedReviewer: null, resolution: null });
  }

  async createFlag(f: { id: string; reportId: string; userId: string; technique: string; note?: string; createdAt: string }): Promise<void> {
    // Mirror Postgres' UNIQUE (report_id, user_id, technique) idempotency.
    const dup = this.flags.some(
      (x) => x.reportId === f.reportId && x.userId === f.userId && x.technique === f.technique,
    );
    // Req 8.4: a freshly created intake is a pending Review_Item, unassigned, unresolved.
    if (!dup) this.flags.push({ ...f, reviewStatus: 'pending', assignedReviewer: null, resolution: null });
  }

  // ponytail: append-only in-memory log keyed by reportId — non-durable, dev/test parity.
  async saveAuditRecord(reportId: string, record: AuditRecord): Promise<void> {
    const list = this.auditRecords.get(reportId);
    if (list) list.push(record);
    else this.auditRecords.set(reportId, [record]);
  }

  // ---- Review workflow (expert-review-queue) -------------------------------
  // Review state lives on the disputes/flags rows above; these methods are the
  // only access path (Req 6.1). Each runs to completion with no `await` between
  // its read and write, so on the single-threaded event loop a claim/release/
  // resolve is atomic by construction — no interleaving (Req 3.5).

  // Project a stored row to the identity-free Review_Item shape. A flag's userId
  // is deliberately NOT projected — no submitter identity reaches a Review_Item
  // (Req 8.2).
  private toReviewItem(kind: ReviewKind, row: (DisputeRow & ReviewFields) | (FlagRow & ReviewFields)): ReviewItem {
    const item: ReviewItem = {
      id: `${kind}:${row.id}`,
      kind,
      reportId: row.reportId,
      status: row.reviewStatus,
      assignedReviewer: row.assignedReviewer,
      createdAt: row.createdAt,
    };
    if (kind === 'dispute') {
      const d = row as DisputeRow & ReviewFields;
      item.reason = d.reason;
      if (d.claimId !== undefined) item.claimId = d.claimId; // only when present (Req 2.3)
    } else {
      const f = row as FlagRow & ReviewFields;
      item.technique = f.technique;
      if (f.note !== undefined) item.note = f.note; // only when present (Req 2.3)
    }
    return item;
  }

  // Resolve a Review_Item id to its kind + the live row object (mutable in place).
  private locate(id: string): { kind: ReviewKind; row: (DisputeRow & ReviewFields) | (FlagRow & ReviewFields) } | undefined {
    const parsed = parseReviewItemId(id);
    if (!parsed) return undefined;
    const arr = parsed.kind === 'dispute' ? this.disputes : this.flags;
    const row = arr.find((r) => r.id === parsed.sourceId);
    return row ? { kind: parsed.kind, row } : undefined;
  }

  async listReviewItems(filter?: { status?: ReviewLifecycle }): Promise<ReviewItem[]> {
    const items: ReviewItem[] = [
      ...this.disputes.map((d) => this.toReviewItem('dispute', d)),
      ...this.flags.map((f) => this.toReviewItem('flag', f)),
    ];
    const filtered = filter?.status ? items.filter((i) => i.status === filter.status) : items;
    // createdAt ascending; ties broken by reportId ascending (Req 2.6).
    filtered.sort((a, b) =>
      a.createdAt < b.createdAt ? -1
      : a.createdAt > b.createdAt ? 1
      : a.reportId < b.reportId ? -1
      : a.reportId > b.reportId ? 1
      : 0,
    );
    return filtered; // [] when nothing matches (Req 2.8, 6.8)
  }

  async claimReviewItem(id: string, reviewer: string): Promise<ReviewActionResult> {
    const found = this.locate(id);
    if (!found) return { ok: false, reason: 'not_found' }; // Req 3.6
    const { kind, row } = found;
    if (row.reviewStatus === 'pending') {
      // Atomic compare-and-set: grant (Req 3.1).
      row.assignedReviewer = reviewer;
      row.reviewStatus = 'in_review';
      return { ok: true, item: this.toReviewItem(kind, row) };
    }
    if (row.reviewStatus === 'in_review' && row.assignedReviewer === reviewer) {
      return { ok: true, item: this.toReviewItem(kind, row) }; // idempotent re-claim (Req 3.4)
    }
    // in_review held by another reviewer (Req 3.2) or resolved (Req 3.3).
    return { ok: false, reason: 'conflict' };
  }

  async releaseReviewItem(id: string, reviewer: string): Promise<ReviewActionResult> {
    const found = this.locate(id);
    if (!found) return { ok: false, reason: 'not_found' };
    const { kind, row } = found;
    if (row.reviewStatus === 'in_review' && row.assignedReviewer === reviewer) {
      row.assignedReviewer = null;
      row.reviewStatus = 'pending';
      return { ok: true, item: this.toReviewItem(kind, row) }; // Req 3.7
    }
    // Not held by the caller (pending, resolved, or held by another) (Req 3.8, 6.7).
    return { ok: false, reason: 'not_actionable' };
  }

  async recordReviewResolution(id: string, resolution: ReviewResolutionInput): Promise<ReviewActionResult> {
    const found = this.locate(id);
    if (!found) return { ok: false, reason: 'not_found' }; // Req 4.4
    const { kind, row } = found;
    // No prior claim required; overwrites any existing resolution so an
    // already-resolved row is replaced, never duplicated (Req 4.1, 4.5).
    row.resolution = {
      outcome: resolution.outcome,
      ...(resolution.note !== undefined ? { note: resolution.note } : {}),
      reviewer: resolution.reviewer,
      resolvedAt: new Date().toISOString(),
    };
    row.reviewStatus = 'resolved';
    return { ok: true, item: this.toReviewItem(kind, row) };
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
