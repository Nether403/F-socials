// In-memory implementations of Cache, Queue, Repository.
// ponytail: single-process, non-durable — fine for the first slice and tests.
// Ceiling: nothing survives a restart and the queue won't scale across processes.
// Upgrade path: Upstash Redis (Cache/Queue) + Postgres (Repository).

import type { AnalysisReport, ContentItem } from '../types';
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

  async findContentByHash(hash: string): Promise<ContentItem | undefined> {
    return this.contentByHash.get(hash);
  }
  async saveContent(item: ContentItem): Promise<void> {
    this.contentByHash.set(item.urlHash, item);
  }
  async saveReport(report: AnalysisReport): Promise<void> {
    this.reports.set(report.id, report);
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
