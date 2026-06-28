// Postgres-backed Repository (Neon). v1 persists the full report as JSONB in
// analysis_reports.data — lossless round-trip, minimal SQL. Keyed columns
// (status, share_slug, content_id) stay populated for indexing/future queries.

import { Pool } from 'pg';
import type {
  AnalysisReport,
  AuditRecord,
  ContentItem,
  ReviewActionResult,
  ReviewItem,
  ReviewKind,
  ReviewLifecycle,
  ReviewResolutionInput,
} from '../types';
import { projectReportGraph } from '../core/reportGraph';
import type { Repository } from './ports';

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
}