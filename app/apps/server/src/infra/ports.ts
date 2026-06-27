// Infrastructure interfaces. In-memory implementations now; swap for
// Upstash Redis (Cache/Queue) and Postgres (Repository) later — no core changes.

import type { AnalysisReport, AuditRecord, ContentItem, RawInput } from '../types';

export interface Cache {
  get(key: string): Promise<AnalysisReport | undefined>;
  set(key: string, report: AnalysisReport): Promise<void>;
}

export interface Job {
  reportId: string;
  contentId: string;
  urlHash: string;
  input: RawInput;
}

export type JobHandler = (job: Job) => Promise<void>;

export interface Queue {
  enqueue(job: Job): Promise<void>;
  process(handler: JobHandler): void;
}

export interface Repository {
  findContentByHash(hash: string): Promise<ContentItem | undefined>;
  saveContent(item: ContentItem): Promise<void>;
  // Persists the report: writes the lossless JSONB payload AND replaces the
  // report's normalized rows (claims/citations/perspective_links) derived from
  // the same object. The JSONB write is authoritative and durable; a normalized
  // write failure is logged (with report_id) and never rethrown, so the report
  // stays served and readable from JSONB. (dual-write — see design.md Req 1, 4)
  saveReport(report: AnalysisReport): Promise<void>;
  getReport(id: string): Promise<AnalysisReport | undefined>;
  getReportBySlug(slug: string): Promise<AnalysisReport | undefined>;
  // Backfill support: true if the report already has normalized rows persisted.
  hasReportGraph(reportId: string): Promise<boolean>;
  // Backfill support: enumerate every persisted report id.
  listReportIds(): Promise<string[]>;
  createDispute(d: { id: string; reportId: string; claimId?: string; reason: string; createdAt: string }): Promise<void>;
  createFlag(f: { id: string; reportId: string; userId: string; technique: string; note?: string; createdAt: string }): Promise<void>;
  // report_id is linked at the insert (the AuditRecord blob itself carries only
  // claimId), mirroring createDispute/createFlag which take reportId explicitly.
  saveAuditRecord(reportId: string, record: AuditRecord): Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
}

export interface RateLimiter {
  // Records one hit for `key` and reports whether it's within the limit.
  hit(key: string): Promise<RateLimitResult>;
}
