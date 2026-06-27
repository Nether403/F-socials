// Postgres-backed Repository (Neon). v1 persists the full report as JSONB in
// analysis_reports.data — lossless round-trip, minimal SQL. Keyed columns
// (status, share_slug, content_id) stay populated for indexing/future queries.

import { Pool } from 'pg';
import type { AnalysisReport, ContentItem } from '../types';
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
  }

  async getReport(id: string): Promise<AnalysisReport | undefined> {
    const r = await this.pool.query(`SELECT data FROM analysis_reports WHERE id = $1`, [id]);
    return r.rows[0] ? (r.rows[0].data as AnalysisReport) : undefined;
  }

  async getReportBySlug(slug: string): Promise<AnalysisReport | undefined> {
    const r = await this.pool.query(`SELECT data FROM analysis_reports WHERE share_slug = $1`, [slug]);
    return r.rows[0] ? (r.rows[0].data as AnalysisReport) : undefined;
  }
}
