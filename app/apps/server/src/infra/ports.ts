// Infrastructure interfaces. In-memory implementations now; swap for
// Upstash Redis (Cache/Queue) and Postgres (Repository) later — no core changes.

import type { AnalysisReport, ContentItem, RawInput } from '../types';

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
  saveReport(report: AnalysisReport): Promise<void>;
  getReport(id: string): Promise<AnalysisReport | undefined>;
  getReportBySlug(slug: string): Promise<AnalysisReport | undefined>;
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
