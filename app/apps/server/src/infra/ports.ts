// Infrastructure interfaces. In-memory implementations now; swap for
// Upstash Redis (Cache/Queue) and Postgres (Repository) later — no core changes.

import type {
  AnalysisReport,
  AuditRecord,
  ContentItem,
  RawInput,
  ReviewActionResult,
  ReviewItem,
  ReviewLifecycle,
  ReviewResolutionInput,
} from '../types';

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

// Lens-safe projection of a reader's saved report: the report identifier plus
// when it was saved. Deliberately carries NO content-truthfulness verdict and NO
// creator-reliability rating — source tiers attach only to sources/citations,
// never to a creator (Req 12.4, 12.5).
export interface SavedReportEntry {
  reportId: string;
  savedAt: string; // ISO 8601
}

// --- Institutional workspace (institutional-workspace) ---

export type WorkspaceRole = 'owner' | 'member';

// Lens-safe projections. None of these carry a content-truthfulness verdict or a
// creator-reliability rating; a Report is referenced by identifier only (Req 10.4,
// 10.5). They carry identifiers, names, a role, timestamps, and annotation text
// only — never a tier, verdict, or creator rating, by construction.
export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole; // the requesting reader's role in this workspace
}

export interface Membership {
  readerId: string; // Supabase JWT subject (TEXT)
  role: WorkspaceRole;
}

export interface SharedCollection {
  id: string;
  name: string;
}

export interface CollectionItemEntry {
  reportId: string;
  addedAt: string; // ISO 8601
}

export interface Annotation {
  id: string;
  workspaceId: string;
  reportId: string;
  authorId: string; // Supabase JWT subject (TEXT)
  text: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
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
  // Review workflow (expert-review-queue). Review state lives as additive columns
  // on disputes/flags, reached only through these methods (Req 6.1). Mutations use
  // a discriminated ReviewActionResult instead of exceptions for expected control
  // flow, so routes map outcomes to HTTP codes (Req 8.1, 8.3).
  listReviewItems(filter?: { status?: ReviewLifecycle }): Promise<ReviewItem[]>;
  claimReviewItem(id: string, reviewer: string): Promise<ReviewActionResult>;
  releaseReviewItem(id: string, reviewer: string): Promise<ReviewActionResult>;
  recordReviewResolution(id: string, resolution: ReviewResolutionInput): Promise<ReviewActionResult>;

  // Saved reports (accounts-save-history). The only persistence path for
  // Saved_Reports (Req 11.1); both drivers return equivalent results for
  // identical inputs (Req 11.2). All three are scoped to readerId — the verified
  // JWT subject — so one reader never reads or mutates another's set.
  //
  // Idempotent: at most one Saved_Report per (readerId, reportId). A repeat save
  // keeps the single existing row and its original savedAt, and reports success
  // without creating a duplicate (Req 7.3, 11.6).
  saveSavedReport(readerId: string, reportId: string): Promise<void>;
  // Idempotent: removing a report not in the reader's set is a no-op success and
  // leaves every other Saved_Report untouched (Req 8.3, 10.7, 11.10).
  removeSavedReport(readerId: string, reportId: string): Promise<void>;
  // Reverse-chronological (savedAt DESC), deterministic tie-break by reportId DESC
  // so equal-timestamp rows keep a stable order across reloads (Req 9.2). Returns
  // only this reader's entries (Req 9.6, 11.8); [] when none (Req 10.8).
  listSavedReports(readerId: string): Promise<SavedReportEntry[]>;

  // --- Workspaces & membership (institutional-workspace) ---
  // The only persistence path for Workspace data (Req 9.1); both drivers return
  // equivalent results for identical inputs (Req 9.2). All reads/writes are scoped
  // by workspace and, where relevant, by the verified reader subject (Req 9.8).
  //
  // Creates a Workspace owned by ownerId and the owner's Owner-Role Membership in
  // one atomic operation; returns the new workspace with the owner's role (Req 1.1).
  createWorkspace(ownerId: string, name: string): Promise<WorkspaceSummary>;
  // Returns every Workspace in which readerId holds a Membership, each with that
  // reader's role; [] when none (Req 4.1, 4.2, 4.3). Excludes all others (Req 9.8).
  listWorkspacesForReader(readerId: string): Promise<WorkspaceSummary[]>;
  // The authorization read: the reader's role in the workspace, or undefined when
  // the reader holds no Membership there (Req 8.2, 8.5).
  getMembership(workspaceId: string, readerId: string): Promise<WorkspaceRole | undefined>;
  // Distinguishes 404 (no such workspace) from 403 (exists, not a member): true iff
  // the workspace exists (Req 8.7).
  workspaceExists(workspaceId: string): Promise<boolean>;
  // Members of one workspace only (Req 3.1, 9.8).
  listMembers(workspaceId: string): Promise<Membership[]>;
  // Deletes the member's Membership. Caller has already enforced owner-only and the
  // not-self rule; idempotent on an absent membership (Req 3.2).
  removeMember(workspaceId: string, readerId: string): Promise<void>;

  // --- Invitations ---
  // Generates an opaque Invite_Code bound to the workspace and returns its value
  // (Req 2.1). Caller has already enforced owner-only (Req 2.2).
  createInvite(workspaceId: string): Promise<string>;
  // Redeems a code: undefined when the code matches no workspace (Req 2.4); else
  // creates a Member-Role Membership for readerId if absent and returns the bound
  // workspace id + the reader's (possibly pre-existing) role — idempotent, never
  // duplicating a membership nor changing an existing role (Req 2.3, 2.5).
  redeemInvite(code: string, readerId: string): Promise<{ workspaceId: string; role: WorkspaceRole } | undefined>;

  // --- Shared collections ---
  createCollection(workspaceId: string, name: string): Promise<SharedCollection>;
  // Collections of one workspace only (Req 5.2, 9.8).
  listCollections(workspaceId: string): Promise<SharedCollection[]>;
  // Deletes the collection AND its Collection_Items (Req 5.5). Scoped to workspace so
  // a collection id from another workspace is never touched.
  deleteCollection(workspaceId: string, collectionId: string): Promise<void>;

  // --- Collection items ---
  // Idempotent: at most one Collection_Item per (collection, report); a repeat add
  // keeps the single existing row and its addedAt (Req 6.2, 9.7).
  addCollectionItem(collectionId: string, reportId: string): Promise<void>;
  // Idempotent: removing an absent item is a no-op success leaving others unchanged
  // (Req 6.6).
  removeCollectionItem(collectionId: string, reportId: string): Promise<void>;
  // Reverse-chronological (addedAt DESC), deterministic tie-break by reportId DESC
  // so equal-timestamp rows keep a stable order across reloads (Req 6.4).
  listCollectionItems(collectionId: string): Promise<CollectionItemEntry[]>;

  // --- Annotations ---
  createAnnotation(input: { workspaceId: string; reportId: string; authorId: string; text: string }): Promise<Annotation>;
  // Annotations for one report within one workspace, most-recently-created first
  // with a deterministic tie-break; excludes every other workspace's (Req 7.2, 9.8).
  listAnnotations(workspaceId: string, reportId: string): Promise<Annotation[]>;
  // Authorization read for edit/delete: the annotation's workspace + author, or
  // undefined when no such annotation exists (Req 7.4, 7.5).
  getAnnotation(annotationId: string): Promise<Annotation | undefined>;
  // Updates only the text and updatedAt (Req 7.3). Caller has enforced authorization.
  updateAnnotation(annotationId: string, text: string): Promise<void>;
  // Deletes the annotation (Req 7.5). Caller has enforced authorization.
  deleteAnnotation(annotationId: string): Promise<void>;
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

// Telemetry: error monitoring (Error_Monitor) + product analytics (Product_Analytics)
// behind one port, mirroring Cache/Queue/Repository/RateLimiter. Methods are
// synchronous void and fire-and-forget: callers never block or await telemetry, and
// a telemetry fault never propagates (fail-open). The composition root picks the
// concrete impl from .env (compose.ts selectTelemetry).
export interface Telemetry {
  // Product_Analytics. `name` is a Telemetry_Event name; `props` is a bag of ids and
  // metrics only. Passed through Redactor AND Neutrality_Guard before emission.
  emit(name: string, props?: Record<string, unknown>): void;
  // Error_Monitor. Captures an error with structured context (reportId, stage,
  // providerCategory, …). Passed through Redactor before emission.
  capture(error: unknown, context?: Record<string, unknown>): void;
}
