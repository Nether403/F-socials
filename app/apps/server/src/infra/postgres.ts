// Postgres-backed Repository (Neon). v1 persists the full report as JSONB in
// analysis_reports.data — lossless round-trip, minimal SQL. Keyed columns
// (status, share_slug, content_id) stay populated for indexing/future queries.

import { randomUUID, randomBytes, createHash } from 'node:crypto';

import { Pool } from 'pg';
import type {
  AnalysisReport,
  AuditRecord,
  CitationRow,
  ClaimRow,
  ContentItem,
  EvidenceOutcome,
  PerspectiveRow,
  ReviewActionResult,
  ReviewItem,
  ReviewKind,
  ReviewLifecycle,
  ReviewResolutionInput,
} from '../types';
import type { HumanSignal } from '../core/kpi';
import { projectReportGraph } from '../core/reportGraph';
import type {
  Annotation,
  ClaimFilter,
  CollectionItemEntry,
  DomainAggregate,
  LocalUser,
  Membership,
  RateLimitConfig,
  RateLimitResult,
  Repository,
  SavedReportEntry,
  SharedCollection,
  TopicAggregate,
  TrustGateConfigRow,
  WorkspaceRole,
  WorkspaceSummary,
} from './ports';

export function makePgPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 5 });
}

export class PostgresRepository implements Repository {
  constructor(private pool: Pool) {}

  async findContentByHash(hash: string): Promise<ContentItem | undefined> {
    const r = await this.pool.query(
      `SELECT id, url_hash, source_type, source_url, title, metadata, created_at
         FROM content_items WHERE url_hash = $1`,
      [hash],
    );
    const row = r.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      urlHash: row.url_hash,
      sourceType: row.source_type,
      sourceUrl: row.source_url ?? undefined,
      title: row.title ?? undefined,
      metadata: row.metadata ?? {},
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async saveContent(item: ContentItem): Promise<void> {
    await this.pool.query(
      `INSERT INTO content_items (id, url_hash, source_type, source_url, title, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (url_hash) DO NOTHING`,
      [item.id, item.urlHash, item.sourceType, item.sourceUrl ?? null, item.title ?? null,
       JSON.stringify(item.metadata ?? {}), item.createdAt],
    );
  }

  async saveReport(report: AnalysisReport): Promise<void> {
    // Authoritative JSONB write — committed on its own, exactly as before, so a
    // normalized-write failure can never roll it back, lose, or corrupt it (Req 4.1).
    await this.pool.query(
      `INSERT INTO analysis_reports
         (id, content_id, status, version, producing_layer, tldr, confidence, share_slug, error, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         version = EXCLUDED.version,
         producing_layer = EXCLUDED.producing_layer,
         tldr = EXCLUDED.tldr,
         confidence = EXCLUDED.confidence,
         share_slug = EXCLUDED.share_slug,
         error = EXCLUDED.error,
         data = EXCLUDED.data,
         updated_at = EXCLUDED.updated_at`,
      [
        report.id, report.contentId, report.status, report.version, report.producingLayer,
        report.tldr ?? null, report.confidence ?? null, report.shareSlug ?? null, report.error ?? null,
        JSON.stringify(report), report.createdAt, report.updatedAt,
      ],
    );

    // Dual-write the normalized rows — best-effort. A failure is logged with the
    // report_id and never rethrown, so the report stays served from JSONB
    // (Req 4.3, 4.5), mirroring saveAuditRecord.
    try {
      await this.writeReportGraph(report);
    } catch (err) {
      console.error(`[repo] writeReportGraph failed (report ${report.id}):`, err);
    }
  }

  // Idempotent replace of one report's Normalized_Rows in a single transaction:
  // delete-then-insert so re-persisting leaves no duplicate or stale rows (Req 5),
  // and a reader never observes a partial set (Req 4.4). Parameterized SQL only.
  private async writeReportGraph(report: AnalysisReport): Promise<void> {
    const graph = projectReportGraph(report);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Delete in FK-safe order: citations (by claim) first, then the report's
      // perspective_links and claims. Removes prior rows regardless of origin.
      await client.query(
        `DELETE FROM citations WHERE claim_id IN (SELECT id FROM claims WHERE report_id = $1)`,
        [report.id],
      );
      await client.query(`DELETE FROM perspective_links WHERE report_id = $1`, [report.id]);
      await client.query(`DELETE FROM claims WHERE report_id = $1`, [report.id]);

      // Re-insert claims, capturing each new row id keyed by its claim_uid so
      // citations can be linked to the freshly-inserted claim rows.
      const claimIdByUid = new Map<string, string>();
      for (const c of graph.claims) {
        const res = await client.query(
          `INSERT INTO claims
             (report_id, claim_uid, claim_text, transcript_span, verifiability,
              evidence_strength, source_basis, confidence, ordinal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            c.reportId, c.claimUid, c.claimText, c.transcriptSpan ?? null, c.verifiability,
            c.evidenceStrength, c.sourceBasis ?? null, c.confidence, c.ordinal,
          ],
        );
        claimIdByUid.set(c.claimUid, res.rows[0].id);
      }

      // Citations linked to the new claim ids via claimUid (Req 2.2).
      for (const cit of graph.citations) {
        const claimId = claimIdByUid.get(cit.claimUid);
        if (!claimId) continue; // projection guarantees linkage; defensive only
        await client.query(
          `INSERT INTO citations
             (claim_id, source_url, source_name, source_tier, excerpt, supports)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [claimId, cit.sourceUrl, cit.sourceName, cit.sourceTier, cit.excerpt ?? null, cit.supports],
        );
      }

      // Perspective links (embedding left NULL — separate concern).
      for (const p of graph.perspectives) {
        await client.query(
          `INSERT INTO perspective_links
             (report_id, url, source_name, source_tier, issue_frame_label,
              divergence_score, dehumanization_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [p.reportId, p.url, p.sourceName, p.sourceTier, p.issueFrameLabel, p.divergence, p.dehumanization],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Backfill support: true if the report already has normalized rows (Req 8.3).
  async hasReportGraph(reportId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM claims WHERE report_id = $1 LIMIT 1`, [reportId]);
    return r.rowCount !== null && r.rowCount > 0;
  }

  // Backfill support: enumerate every persisted report id (Req 8.1).
  async listReportIds(): Promise<string[]> {
    const r = await this.pool.query(`SELECT id FROM analysis_reports`);
    return r.rows.map((row) => row.id as string);
  }

  async getReport(id: string): Promise<AnalysisReport | undefined> {
    const r = await this.pool.query(`SELECT data FROM analysis_reports WHERE id = $1`, [id]);
    return r.rows[0] ? (r.rows[0].data as AnalysisReport) : undefined;
  }

  async getReportBySlug(slug: string): Promise<AnalysisReport | undefined> {
    const r = await this.pool.query(`SELECT data FROM analysis_reports WHERE share_slug = $1`, [slug]);
    return r.rows[0] ? (r.rows[0].data as AnalysisReport) : undefined;
  }

  async createDispute(d: { id: string; reportId: string; claimId?: string; reason: string; createdAt: string }): Promise<void> {
    // raised_by is always NULL — disputes are anonymous (3.2). claim_id added in migration 002.
    await this.pool.query(
      `INSERT INTO disputes (id, report_id, raised_by, claim_id, reason, created_at)
       VALUES ($1, $2, NULL, $3, $4, $5)`,
      [d.id, d.reportId, d.claimId ?? null, d.reason, d.createdAt],
    );
  }

  async createFlag(f: { id: string; reportId: string; userId: string; technique: string; note?: string; createdAt: string }): Promise<void> {
    // UNIQUE (report_id, user_id, technique) makes a repeat flag idempotent (3.5).
    await this.pool.query(
      `INSERT INTO flags (id, report_id, user_id, technique, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (report_id, user_id, technique) DO NOTHING`,
      [f.id, f.reportId, f.userId, f.technique, f.note ?? null, f.createdAt],
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // User_Sync (supabase-user-sync). Idempotent upsert of the local users row keyed
  // to the Supabase subject, derived SOLELY from verified JWT claims — no external
  // call. Parameterized SQL only, no string interpolation (Req 8.1).

  // Single INSERT … ON CONFLICT (id) DO UPDATE. created_at is never in the SET list,
  // so it is preserved on repeat (Req 2.3). email/role params bind NULL when the
  // claim is absent; COALESCE retains the stored value in that case (Req 2.5) and
  // updates when the claim is present (Req 2.4). The statement is atomic, so
  // concurrent syncs converge on exactly one row (Req 2.6) and a failed insert
  // rejects with no partial row (Req 6.3).
  async ensureLocalUser(u: { id: string; email?: string; role?: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id, email, role)
       VALUES ($1, $2, COALESCE($3, 'user'))
       ON CONFLICT (id) DO UPDATE SET
         email = COALESCE($2, users.email),
         role  = COALESCE($3, users.role)`,
      [u.id, u.email ?? null, u.role ?? null],
    );
  }

  // Read-only lookup of the synced Local_User by subject; created_at normalized to
  // ISO 8601, undefined when none (Req 7.2).
  async getLocalUser(id: string): Promise<LocalUser | undefined> {
    const r = await this.pool.query(
      `SELECT id, email, role, created_at FROM users WHERE id = $1`,
      [id],
    );
    const row = r.rows[0];
    return row
      ? { id: row.id, email: row.email ?? null, role: row.role, createdAt: new Date(row.created_at).toISOString() }
      : undefined;
  }

  // Best-effort audit write: the full AuditRecord goes in the JSONB `data` column,
  // report_id/claim_id linked at insert. id + created_at use the table defaults.
  // A failure here is logged and swallowed so it can never block a ready report (6.1).
  async saveAuditRecord(reportId: string, record: AuditRecord): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO audit_records (report_id, claim_id, data)
         VALUES ($1, $2, $3)`,
        [reportId, record.claimId, JSON.stringify(record)],
      );
    } catch (err) {
      console.error(`[repo] saveAuditRecord failed (report ${reportId}, claim ${record.claimId}):`, err);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Expert review queue (Req 2, 3, 4, 6.2). Review state lives as additive columns
  // on disputes/flags (Migration_005). Parameterized SQL only — every caller value
  // is a bound parameter; the only non-parameterized dynamic piece is the table
  // name, derived from the parsed kind via a hardcoded whitelist (never caller text).

  // Parse "{kind}:{sourceId}" → table + sourceId. A malformed id (no valid kind)
  // yields null so the repo can return not_found safely (the route also guards 400).
  private parseReviewId(
    id: string,
  ): { kind: ReviewKind; table: 'disputes' | 'flags'; sourceId: string } | null {
    const sep = id.indexOf(':');
    if (sep <= 0) return null;
    const kind = id.slice(0, sep);
    const sourceId = id.slice(sep + 1);
    if (!sourceId) return null;
    if (kind === 'dispute') return { kind, table: 'disputes', sourceId };
    if (kind === 'flag') return { kind, table: 'flags', sourceId };
    return null;
  }

  // SELECT/RETURNING expression list projecting one table to the common ReviewItem
  // shape: id encodes the kind, the other table's fields are NULL placeholders.
  // Derived from kind only (hardcoded) — no caller text reaches the SQL string.
  private reviewProjection(kind: ReviewKind): string {
    return kind === 'dispute'
      ? `('dispute:' || id) AS id, 'dispute' AS kind, report_id, review_status,
         assigned_reviewer, created_at, reason, claim_id, NULL AS technique, NULL AS note`
      : `('flag:' || id) AS id, 'flag' AS kind, report_id, review_status,
         assigned_reviewer, created_at, NULL AS reason, NULL AS claim_id, technique, note`;
  }

  // Row → ReviewItem. Omits claimId/note when null and never projects any submitter
  // identity (Req 2.2, 2.3, 8.2); assignedReviewer is null when unassigned.
  private rowToReviewItem(row: {
    id: string;
    kind: ReviewKind;
    report_id: string;
    review_status: ReviewLifecycle;
    assigned_reviewer: string | null;
    created_at: string | Date;
    reason: string | null;
    claim_id: string | null;
    technique: string | null;
    note: string | null;
  }): ReviewItem {
    const item: ReviewItem = {
      id: row.id,
      kind: row.kind,
      reportId: row.report_id,
      status: row.review_status,
      assignedReviewer: row.assigned_reviewer ?? null,
      createdAt: new Date(row.created_at).toISOString(),
    };
    if (row.kind === 'dispute') {
      item.reason = row.reason ?? undefined;
      if (row.claim_id != null) item.claimId = row.claim_id;
    } else {
      item.technique = row.technique ?? undefined;
      if (row.note != null) item.note = row.note;
    }
    return item;
  }

  // UNION ALL of disputes + flags projected to ReviewItem, ordered created_at asc
  // then report_id asc (Req 2.6). $1 is the optional status filter (NULL = no
  // filter), cast to the enum on both sides so a single consistent param type is
  // inferred and the review_status index stays usable (Req 2.1–2.4, 2.8).
  async listReviewItems(filter?: { status?: ReviewLifecycle }): Promise<ReviewItem[]> {
    const status = filter?.status ?? null;
    const r = await this.pool.query(
      `SELECT ('dispute:' || id) AS id, 'dispute' AS kind, report_id, review_status,
              assigned_reviewer, created_at, reason, claim_id, NULL AS technique, NULL AS note
         FROM disputes
        WHERE ($1::review_status_kind IS NULL OR review_status = $1::review_status_kind)
       UNION ALL
       SELECT ('flag:' || id), 'flag', report_id, review_status,
              assigned_reviewer, created_at, NULL, NULL, technique, note
         FROM flags
        WHERE ($1::review_status_kind IS NULL OR review_status = $1::review_status_kind)
        ORDER BY created_at ASC, report_id ASC`,
      [status],
    );
    return r.rows.map((row) => this.rowToReviewItem(row));
  }

  // Atomic compare-and-set: grants a pending item to the caller and makes a
  // same-reviewer re-claim a no-op success; the predicate grants exactly one
  // concurrent winner via row locking (Req 3.1, 3.4, 3.5). rowCount 0 → a
  // follow-up SELECT classifies not_found vs conflict (Req 3.2, 3.3, 3.6).
  async claimReviewItem(id: string, reviewer: string): Promise<ReviewActionResult> {
    const parsed = this.parseReviewId(id);
    if (!parsed) return { ok: false, reason: 'not_found' };
    const r = await this.pool.query(
      `UPDATE ${parsed.table}
          SET assigned_reviewer = $1, review_status = 'in_review'
        WHERE id = $2
          AND (review_status = 'pending'
               OR (review_status = 'in_review' AND assigned_reviewer = $1))
        RETURNING ${this.reviewProjection(parsed.kind)}`,
      [reviewer, parsed.sourceId],
    );
    if (r.rowCount === 1) return { ok: true, item: this.rowToReviewItem(r.rows[0]) };
    const exists = await this.pool.query(`SELECT 1 FROM ${parsed.table} WHERE id = $1`, [parsed.sourceId]);
    if (exists.rowCount === 0) return { ok: false, reason: 'not_found' };
    return { ok: false, reason: 'conflict' };
  }

  // Release only an item the caller currently holds (in_review + assigned to them),
  // returning it to pending (Req 3.7). rowCount 0 → not_found vs not_actionable (Req 3.8).
  async releaseReviewItem(id: string, reviewer: string): Promise<ReviewActionResult> {
    const parsed = this.parseReviewId(id);
    if (!parsed) return { ok: false, reason: 'not_found' };
    const r = await this.pool.query(
      `UPDATE ${parsed.table}
          SET assigned_reviewer = NULL, review_status = 'pending'
        WHERE id = $2 AND review_status = 'in_review' AND assigned_reviewer = $1
        RETURNING ${this.reviewProjection(parsed.kind)}`,
      [reviewer, parsed.sourceId],
    );
    if (r.rowCount === 1) return { ok: true, item: this.rowToReviewItem(r.rows[0]) };
    const exists = await this.pool.query(`SELECT 1 FROM ${parsed.table} WHERE id = $1`, [parsed.sourceId]);
    if (exists.rowCount === 0) return { ok: false, reason: 'not_found' };
    return { ok: false, reason: 'not_actionable' };
  }

  // Record a resolution on any existing row regardless of status (no prior claim
  // required; an already-resolved row is overwritten, never duplicated — Req 4.1,
  // 4.5). rowCount 0 means only that no row carries the id → not_found (Req 4.4).
  async recordReviewResolution(id: string, resolution: ReviewResolutionInput): Promise<ReviewActionResult> {
    const parsed = this.parseReviewId(id);
    if (!parsed) return { ok: false, reason: 'not_found' };
    const resolvedAt = new Date().toISOString();
    const r = await this.pool.query(
      `UPDATE ${parsed.table}
          SET review_status = 'resolved',
              resolution_outcome = $1,
              resolution_note = $2,
              resolved_by = $3,
              review_resolved_at = $4
        WHERE id = $5
        RETURNING ${this.reviewProjection(parsed.kind)}`,
      [resolution.outcome, resolution.note ?? null, resolution.reviewer, resolvedAt, parsed.sourceId],
    );
    if (r.rowCount === 1) return { ok: true, item: this.rowToReviewItem(r.rows[0]) };
    return { ok: false, reason: 'not_found' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Saved reports (accounts-save-history). Parameterized SQL only; all three are
  // scoped to reader_id (the verified JWT subject). A backing-store failure
  // propagates as a rejected promise → route maps to 5xx, no partial mutation
  // (Req 11.5, 11.9, 9.2, 9.6).

  // Idempotent upsert: ON CONFLICT keeps the original saved_at (Req 7.3, 11.6).
  async saveSavedReport(readerId: string, reportId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO reader_saved_reports (reader_id, report_id) VALUES ($1, $2)
       ON CONFLICT (reader_id, report_id) DO NOTHING`,
      [readerId, reportId],
    );
  }

  // Idempotent delete scoped to the reader; absent row ⇒ no-op (Req 8.3, 10.7, 11.10).
  async removeSavedReport(readerId: string, reportId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM reader_saved_reports WHERE reader_id=$1 AND report_id=$2`,
      [readerId, reportId],
    );
  }

  // Reader-scoped, reverse-chronological with deterministic tie-break (Req 9.2, 9.6).
  async listSavedReports(readerId: string): Promise<SavedReportEntry[]> {
    const r = await this.pool.query(
      `SELECT report_id, saved_at FROM reader_saved_reports
       WHERE reader_id=$1 ORDER BY saved_at DESC, report_id DESC`,
      [readerId],
    );
    return r.rows.map((row) => ({
      reportId: row.report_id,
      savedAt: new Date(row.saved_at).toISOString(),
    }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Institutional workspace (institutional-workspace). The only persistence path
  // for Workspace data (Req 9.1); parameterized SQL only, every caller value bound
  // (Req 9.6). Results mirror InMemoryRepository (Req 9.2). A backing-store failure
  // propagates as a rejected promise → route maps to 5xx, existing data unchanged,
  // no partial mutation (Req 9.9).

  // Row → Annotation. Timestamps normalized to ISO 8601, mirroring the in-memory shape.
  private rowToAnnotation(row: {
    id: string;
    workspace_id: string;
    report_id: string;
    author_id: string;
    text: string;
    created_at: string | Date;
    updated_at: string | Date;
  }): Annotation {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      reportId: row.report_id,
      authorId: row.author_id,
      text: row.text,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  // --- Workspaces & membership ---

  async createWorkspace(ownerId: string, name: string): Promise<WorkspaceSummary> {
    // Two writes in one transaction so a workspace never exists without its owner
    // Membership (Req 1.1). The id is generated in app code (mirrors in-memory).
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO workspaces (id, name, owner_id) VALUES ($1, $2, $3)`, [id, name, ownerId]);
      await client.query(
        `INSERT INTO workspace_members (workspace_id, reader_id, role) VALUES ($1, $2, 'owner')`,
        [id, ownerId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return { id, name, role: 'owner' };
  }

  async listWorkspacesForReader(readerId: string): Promise<WorkspaceSummary[]> {
    // Reader-scoped (Req 4.1, 4.2, 9.8); deterministic order by name then id (Req 4.3).
    const r = await this.pool.query(
      `SELECT w.id, w.name, m.role
         FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.reader_id = $1
        ORDER BY w.name ASC, w.id ASC`,
      [readerId],
    );
    return r.rows.map((row) => ({ id: row.id, name: row.name, role: row.role as WorkspaceRole }));
  }

  async getMembership(workspaceId: string, readerId: string): Promise<WorkspaceRole | undefined> {
    // The authorization read: the reader's role, or undefined when no Membership (Req 8.2, 8.5).
    const r = await this.pool.query(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND reader_id = $2`,
      [workspaceId, readerId],
    );
    return r.rows[0] ? (r.rows[0].role as WorkspaceRole) : undefined;
  }

  async workspaceExists(workspaceId: string): Promise<boolean> {
    // Distinguishes 404 (no such workspace) from 403 (exists, not a member) (Req 8.7).
    const r = await this.pool.query(`SELECT 1 FROM workspaces WHERE id = $1`, [workspaceId]);
    return r.rowCount !== null && r.rowCount > 0;
  }

  async listMembers(workspaceId: string): Promise<Membership[]> {
    // Members of one workspace only (Req 3.1, 9.8).
    const r = await this.pool.query(
      `SELECT reader_id, role FROM workspace_members WHERE workspace_id = $1`,
      [workspaceId],
    );
    return r.rows.map((row) => ({ readerId: row.reader_id, role: row.role as WorkspaceRole }));
  }

  async removeMember(workspaceId: string, readerId: string): Promise<void> {
    // Idempotent on an absent membership; caller has enforced owner-only and not-self (Req 3.2).
    await this.pool.query(
      `DELETE FROM workspace_members WHERE workspace_id = $1 AND reader_id = $2`,
      [workspaceId, readerId],
    );
  }

  // --- Invitations ---

  async createInvite(workspaceId: string): Promise<string> {
    // Opaque redeemable token bound to the workspace (Req 2.1). Caller has
    // enforced owner-only (Req 2.2).
    const code = randomUUID();
    await this.pool.query(
      `INSERT INTO workspace_invites (code, workspace_id) VALUES ($1, $2)`,
      [code, workspaceId],
    );
    return code;
  }

  async redeemInvite(
    code: string,
    readerId: string,
  ): Promise<{ workspaceId: string; role: WorkspaceRole } | undefined> {
    const lookup = await this.pool.query(
      `SELECT workspace_id FROM workspace_invites WHERE code = $1`,
      [code],
    );
    if (!lookup.rows[0]) return undefined; // no match (Req 2.4)
    const workspaceId = lookup.rows[0].workspace_id as string;
    // Idempotent membership: insert a Member-Role Membership only if absent, never
    // duplicating nor changing an existing role (Req 2.3, 2.5).
    await this.pool.query(
      `INSERT INTO workspace_members (workspace_id, reader_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (workspace_id, reader_id) DO NOTHING`,
      [workspaceId, readerId],
    );
    // Read back the reader's (possibly pre-existing) role.
    const role = await this.getMembership(workspaceId, readerId);
    return { workspaceId, role: role ?? 'member' };
  }

  // --- Shared collections ---

  async createCollection(workspaceId: string, name: string): Promise<SharedCollection> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO shared_collections (id, workspace_id, name) VALUES ($1, $2, $3)`,
      [id, workspaceId, name],
    );
    return { id, name };
  }

  async listCollections(workspaceId: string): Promise<SharedCollection[]> {
    // Collections of one workspace only (Req 5.2, 9.8).
    const r = await this.pool.query(
      `SELECT id, name FROM shared_collections WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC`,
      [workspaceId],
    );
    return r.rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async deleteCollection(workspaceId: string, collectionId: string): Promise<void> {
    // Delete the collection AND its items together in one transaction so a deleted
    // collection never orphans items (Req 5.5). Scoped to the workspace so a
    // collection id from another workspace is never touched.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM collection_items
          WHERE collection_id IN (
            SELECT id FROM shared_collections WHERE id = $1 AND workspace_id = $2
          )`,
        [collectionId, workspaceId],
      );
      await client.query(
        `DELETE FROM shared_collections WHERE id = $1 AND workspace_id = $2`,
        [collectionId, workspaceId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Collection items ---

  async addCollectionItem(collectionId: string, reportId: string): Promise<void> {
    // Idempotent upsert; keeps the single existing row and its added_at (Req 6.2, 9.7).
    await this.pool.query(
      `INSERT INTO collection_items (collection_id, report_id)
       VALUES ($1, $2)
       ON CONFLICT (collection_id, report_id) DO NOTHING`,
      [collectionId, reportId],
    );
  }

  async removeCollectionItem(collectionId: string, reportId: string): Promise<void> {
    // Absent ⇒ no-op success leaving others unchanged (Req 6.6).
    await this.pool.query(
      `DELETE FROM collection_items WHERE collection_id = $1 AND report_id = $2`,
      [collectionId, reportId],
    );
  }

  async listCollectionItems(collectionId: string): Promise<CollectionItemEntry[]> {
    // Reverse-chronological with deterministic tie-break by report_id DESC (Req 6.4).
    const r = await this.pool.query(
      `SELECT report_id, added_at FROM collection_items
        WHERE collection_id = $1 ORDER BY added_at DESC, report_id DESC`,
      [collectionId],
    );
    return r.rows.map((row) => ({
      reportId: row.report_id,
      addedAt: new Date(row.added_at).toISOString(),
    }));
  }

  // --- Annotations ---

  async createAnnotation(input: {
    workspaceId: string;
    reportId: string;
    authorId: string;
    text: string;
  }): Promise<Annotation> {
    const id = randomUUID();
    const r = await this.pool.query(
      `INSERT INTO annotations (id, workspace_id, report_id, author_id, text)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, workspace_id, report_id, author_id, text, created_at, updated_at`,
      [id, input.workspaceId, input.reportId, input.authorId, input.text],
    );
    return this.rowToAnnotation(r.rows[0]);
  }

  async listAnnotations(workspaceId: string, reportId: string): Promise<Annotation[]> {
    // One report within one workspace, most-recently-created first with a
    // deterministic tie-break; excludes every other workspace's (Req 7.2, 9.8).
    const r = await this.pool.query(
      `SELECT id, workspace_id, report_id, author_id, text, created_at, updated_at
         FROM annotations WHERE workspace_id = $1 AND report_id = $2
        ORDER BY created_at DESC, id DESC`,
      [workspaceId, reportId],
    );
    return r.rows.map((row) => this.rowToAnnotation(row));
  }

  async getAnnotation(annotationId: string): Promise<Annotation | undefined> {
    // Authorization read for edit/delete: the annotation's workspace + author, or
    // undefined when no such annotation exists (Req 7.4, 7.5).
    const r = await this.pool.query(
      `SELECT id, workspace_id, report_id, author_id, text, created_at, updated_at
         FROM annotations WHERE id = $1`,
      [annotationId],
    );
    return r.rows[0] ? this.rowToAnnotation(r.rows[0]) : undefined;
  }

  async updateAnnotation(annotationId: string, text: string): Promise<void> {
    // Updates only the text and updated_at (Req 7.3). Caller has enforced authorization.
    await this.pool.query(
      `UPDATE annotations SET text = $2, updated_at = now() WHERE id = $1`,
      [annotationId, text],
    );
  }

  async deleteAnnotation(annotationId: string): Promise<void> {
    // Caller has enforced authorization (Req 7.5).
    await this.pool.query(`DELETE FROM annotations WHERE id = $1`, [annotationId]);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Institutional API keys (intervention-and-scale). Parameterized SQL only;
  // plaintext never persisted — only the SHA-256 hash (Req 6.8, 14.5). DB errors
  // propagate to the caller with no partial write (Req 14.8).

  async createApiKey(institutionId: string): Promise<{ keyId: string; plaintext: string }> {
    // Enforce <=10 active keys per institution (Req 6.7).
    const countRes = await this.pool.query(
      `SELECT COUNT(*) AS cnt FROM api_keys WHERE institution_id = $1 AND revoked_at IS NULL`,
      [institutionId],
    );
    if (Number(countRes.rows[0].cnt) >= 10) {
      throw new Error('ActiveKeyLimit');
    }
    const keyId = randomUUID();
    const plaintext = randomBytes(32).toString('base64url');
    const keyHash = createHash('sha256').update(plaintext).digest('hex');
    await this.pool.query(
      `INSERT INTO api_keys (id, institution_id, key_hash) VALUES ($1, $2, $3)`,
      [keyId, institutionId, keyHash],
    );
    return { keyId, plaintext };
  }

  async findApiKeyByHash(hash: string): Promise<{ keyId: string; institutionId: string; rateLimit?: RateLimitConfig } | undefined> {
    const r = await this.pool.query(
      `SELECT id, institution_id, rate_max, rate_window_s
         FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
      [hash],
    );
    const row = r.rows[0];
    if (!row) return undefined;
    const result: { keyId: string; institutionId: string; rateLimit?: RateLimitConfig } = {
      keyId: row.id,
      institutionId: row.institution_id,
    };
    if (row.rate_max != null && row.rate_window_s != null) {
      result.rateLimit = { maxRequests: row.rate_max, windowSeconds: row.rate_window_s };
    }
    return result;
  }

  async revokeApiKey(keyId: string): Promise<void> {
    await this.pool.query(
      `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`,
      [keyId],
    );
  }

  async countActiveApiKeys(institutionId: string): Promise<number> {
    const r = await this.pool.query(
      `SELECT COUNT(*) AS cnt FROM api_keys WHERE institution_id = $1 AND revoked_at IS NULL`,
      [institutionId],
    );
    return Number(r.rows[0].cnt);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Per-key institutional rate limiting (intervention-and-scale). Fixed-window
  // counter using the `api_key_rate_windows` table (Req 8.2, 8.4, 8.6).

  async institutionalHit(keyId: string, cfg: RateLimitConfig): Promise<RateLimitResult> {
    const now = new Date();
    const windowMs = cfg.windowSeconds * 1000;

    // Read existing window; if absent or expired, create a new one.
    const existing = await this.pool.query(
      `SELECT window_start, count FROM api_key_rate_windows WHERE key_id = $1`,
      [keyId],
    );

    let windowStart: Date;
    let count: number;

    if (existing.rows[0]) {
      windowStart = new Date(existing.rows[0].window_start);
      const elapsed = now.getTime() - windowStart.getTime();
      if (elapsed >= windowMs) {
        // Window expired — reset (Req 8.6).
        windowStart = now;
        count = 1;
        await this.pool.query(
          `UPDATE api_key_rate_windows SET window_start = $1, count = 1 WHERE key_id = $2`,
          [windowStart.toISOString(), keyId],
        );
      } else {
        // Increment current window.
        count = existing.rows[0].count + 1;
        await this.pool.query(
          `UPDATE api_key_rate_windows SET count = $1 WHERE key_id = $2`,
          [count, keyId],
        );
      }
    } else {
      // First hit for this key — create window.
      windowStart = now;
      count = 1;
      await this.pool.query(
        `INSERT INTO api_key_rate_windows (key_id, window_start, count)
         VALUES ($1, $2, 1)
         ON CONFLICT (key_id) DO UPDATE SET window_start = EXCLUDED.window_start, count = 1`,
        [keyId, windowStart.toISOString()],
      );
    }

    const resetSeconds = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
    return {
      allowed: count <= cfg.maxRequests,
      remaining: Math.max(0, cfg.maxRequests - count),
      limit: cfg.maxRequests,
      resetSeconds,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Trust-gate config (intervention-and-scale). Optional runtime override for a
  // capability; env is the floor/source of truth (Req 12.2, 12.4).

  async getTrustGateConfig(capability: string): Promise<TrustGateConfigRow | undefined> {
    const r = await this.pool.query(
      `SELECT capability, coverage_min, agreement_min, legal_review_ok, updated_at
         FROM trust_gate_config WHERE capability = $1`,
      [capability],
    );
    const row = r.rows[0];
    if (!row) return undefined;
    return {
      capability: row.capability,
      coverageMin: Number(row.coverage_min),
      agreementMin: Number(row.agreement_min),
      legalReviewOk: row.legal_review_ok,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Read-only metric aggregates (intervention-and-scale). Enumerate already-
  // persisted audit/signal data for KPI re-computation (Req 1.6, 1.8, 14.6).

  async listEvidenceOutcomes(): Promise<Array<{ reportId: string; claimId: string; evidenceOutcome: EvidenceOutcome }>> {
    const r = await this.pool.query(
      `SELECT report_id, claim_id, data FROM audit_records`,
    );
    return r.rows.map((row) => {
      const data = row.data as AuditRecord;
      return {
        reportId: row.report_id as string,
        claimId: row.claim_id as string,
        evidenceOutcome: data.evidenceOutcome,
      };
    });
  }

  async listHumanSignals(): Promise<HumanSignal[]> {
    // Disputes and flags, id-only (no submitter identity — Req 8.7).
    const disputes = await this.pool.query(
      `SELECT report_id, claim_id FROM disputes`,
    );
    const flags = await this.pool.query(
      `SELECT report_id, claim_id FROM flags`,
    );
    const signals: HumanSignal[] = [];
    for (const row of disputes.rows) {
      if (row.claim_id) {
        signals.push({ kind: 'dispute', reportId: row.report_id, claimId: row.claim_id });
      }
    }
    for (const row of flags.rows) {
      if (row.claim_id) {
        signals.push({ kind: 'flag', reportId: row.report_id, claimId: row.claim_id });
      }
    }
    return signals;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Read-only Report_Graph queries (intervention-and-scale). SELECT-only against
  // claims/citations/perspective_links (Req 9.1, 9.2). Parameterized SQL only
  // (Req 14.5). Empty matches → empty result, no error (Req 9.3).

  async queryClaims(filter: ClaimFilter): Promise<{ items: ClaimRow[]; totalCount: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.reportId) {
      conditions.push(`c.report_id = $${idx++}`);
      params.push(filter.reportId);
    }
    if (filter.keyword) {
      conditions.push(`c.claim_text ILIKE $${idx++}`);
      params.push(`%${filter.keyword}%`);
    }
    if (filter.fromDate) {
      conditions.push(`ar.created_at >= $${idx++}`);
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      conditions.push(`ar.created_at <= $${idx++}`);
      params.push(filter.toDate);
    }
    if (filter.topic) {
      conditions.push(`EXISTS (SELECT 1 FROM perspective_links pl WHERE pl.report_id = c.report_id AND pl.issue_frame_label = $${idx++})`);
      params.push(filter.topic);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const needsJoin = filter.fromDate || filter.toDate;
    const fromClause = needsJoin
      ? `FROM claims c JOIN analysis_reports ar ON ar.id = c.report_id`
      : `FROM claims c`;

    // Count total matching rows.
    const countSql = `SELECT COUNT(*) AS cnt ${fromClause} ${where}`;
    const countRes = await this.pool.query(countSql, params);
    const totalCount = Number(countRes.rows[0].cnt);

    // Paginate.
    const page = Math.max(0, filter.page ?? 0);
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
    const offset = page * pageSize;

    // ORDER BY report_id ASC, ordinal ASC — matches the in-memory driver exactly
    // (ordinals are unique within a report, so this is a total, deterministic order).
    const dataSql = `SELECT c.claim_uid, c.report_id, c.claim_text, c.transcript_span,
                            c.verifiability, c.evidence_strength, c.source_basis,
                            c.confidence, c.ordinal
                     ${fromClause} ${where}
                     ORDER BY c.report_id ASC, c.ordinal ASC
                     LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(pageSize, offset);

    const dataRes = await this.pool.query(dataSql, params);
    const items: ClaimRow[] = dataRes.rows.map((row) => ({
      claimUid: row.claim_uid,
      reportId: row.report_id,
      claimText: row.claim_text,
      transcriptSpan: row.transcript_span ?? undefined,
      verifiability: row.verifiability,
      evidenceStrength: row.evidence_strength,
      sourceBasis: row.source_basis ?? undefined,
      confidence: Number(row.confidence),
      ordinal: Number(row.ordinal),
    }));

    return { items, totalCount };
  }

  async listCitationsForClaim(claimUid: string): Promise<CitationRow[]> {
    // Deterministic content order matching the in-memory driver (Req 14.2): the
    // citation id is a random UUID (no insertion-order column), so order by the
    // stable content key. ponytail: free-text ORDER BY is subject to DB collation;
    // the parity test keys on this same (sourceUrl, sourceName, excerpt) tuple.
    const r = await this.pool.query(
      `SELECT ci.source_url, ci.source_name, ci.source_tier, ci.excerpt, ci.supports, c.claim_uid
         FROM citations ci
         JOIN claims c ON c.id = ci.claim_id
        WHERE c.claim_uid = $1
        ORDER BY ci.source_url ASC, COALESCE(ci.source_name, '') ASC, COALESCE(ci.excerpt, '') ASC`,
      [claimUid],
    );
    return r.rows.map((row) => ({
      claimUid: row.claim_uid,
      sourceUrl: row.source_url,
      sourceName: row.source_name,
      sourceTier: row.source_tier,
      excerpt: row.excerpt ?? undefined,
      supports: row.supports,
    }));
  }

  async listPerspectivesForReport(reportId: string): Promise<PerspectiveRow[]> {
    // Deterministic content order matching the in-memory driver (Req 14.2); the id
    // is a random UUID, so order by the stable (url, issue_frame_label) key.
    const r = await this.pool.query(
      `SELECT report_id, url, source_name, source_tier, issue_frame_label,
              divergence_score, dehumanization_score
         FROM perspective_links WHERE report_id = $1
        ORDER BY url ASC, COALESCE(issue_frame_label, '') ASC`,
      [reportId],
    );
    return r.rows.map((row) => ({
      reportId: row.report_id,
      url: row.url,
      sourceName: row.source_name,
      sourceTier: row.source_tier,
      issueFrameLabel: row.issue_frame_label,
      divergence: Number(row.divergence_score),
      dehumanization: Number(row.dehumanization_score),
    }));
  }

  async aggregateByDomain(): Promise<DomainAggregate[]> {
    // Group citations by the domain of source_url, count distinct reports and
    // claims, and compute the mean ratio of claims-with-citations to total claims
    // per report within each domain group (Req 9.4).
    const r = await this.pool.query(
      `WITH domain_citations AS (
         SELECT
           COALESCE(
             substring(ci.source_url from '://([^/]+)'),
             ci.source_url
           ) AS domain,
           c.report_id,
           c.claim_uid
         FROM citations ci
         JOIN claims c ON c.id = ci.claim_id
       ),
       per_report AS (
         SELECT
           dc.domain,
           dc.report_id,
           COUNT(DISTINCT dc.claim_uid) AS cited_claims,
           total.total_claims
         FROM domain_citations dc
         JOIN (
           SELECT report_id, COUNT(*) AS total_claims FROM claims GROUP BY report_id
         ) total ON total.report_id = dc.report_id
         GROUP BY dc.domain, dc.report_id, total.total_claims
       )
       SELECT
         domain,
         COUNT(DISTINCT report_id)::int AS report_count,
         SUM(cited_claims)::int AS claim_count,
         AVG(cited_claims::float / GREATEST(total_claims, 1)) AS mean_cited_claim_ratio
       FROM per_report
       GROUP BY domain
       ORDER BY domain ASC`,
    );
    return r.rows.map((row) => ({
      domain: row.domain,
      reportCount: Number(row.report_count),
      claimCount: Number(row.claim_count),
      meanCitedClaimRatio: Number(row.mean_cited_claim_ratio),
    }));
  }

  async aggregateByTopic(): Promise<TopicAggregate[]> {
    // Group reports by issue_frame_label from perspective_links (Req 9.4).
    const r = await this.pool.query(
      `SELECT issue_frame_label, COUNT(DISTINCT report_id)::int AS report_count
         FROM perspective_links
        GROUP BY issue_frame_label
        ORDER BY issue_frame_label ASC`,
    );
    return r.rows.map((row) => ({
      issueFrameLabel: row.issue_frame_label,
      reportCount: Number(row.report_count),
    }));
  }
}