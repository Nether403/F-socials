// Feature: report-graph-normalization — Postgres integration test (task 10.1).
//
// Migration applies and is non-destructive: seed a row in analysis_reports
// (with a JSONB data payload), apply 004_report_graph.sql, then assert the new
// claims.claim_uid column and the new indexes exist AND the seeded report data
// is intact and still served by PostgresRepository.getReport.
//
// This test REQUIRES a real Postgres. Without a connection string it SKIPS
// cleanly (node:test `{ skip }`), so the offline-first suite stays green with
// zero API keys / no database. Point it at a throwaway DB via TEST_DATABASE_URL
// (preferred) or DATABASE_URL. It mirrors scripts/migrate.mjs: it applies the
// base migrations (001–003) swallowing "already exists" so the schema is
// present whether the DB is fresh or already migrated, then applies 004.
//
// Validates: Requirements 7.2, 7.3

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { makePgPool, PostgresRepository } from '../src/infra/postgres';
import type { AnalysisReport } from '../src/types';

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

// The new schema objects 004 introduces — the assertions below check these.
const NEW_INDEXES = [
  'uq_claims_report_claimuid',
  'idx_citations_source_url',
  'idx_citations_source_tier',
  'idx_claims_claim_text',
  'idx_perspective_source_tier',
];

function readMigration(file: string): string {
  return readFileSync(resolve(migrationsDir, file), 'utf8');
}

// Apply a migration file, swallowing "already exists" so a DB that has already
// been migrated is fine (mirrors scripts/migrate.mjs). Re-throws anything else.
async function applyMigration(pool: import('pg').Pool, file: string): Promise<void> {
  try {
    await pool.query(readMigration(file));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already exists/i.test(msg)) throw e;
  }
}

test('migration 004 adds claim_uid + indexes and is non-destructive', { skip: !DB_URL }, async () => {
  const pool = makePgPool(DB_URL as string);
  const repo = new PostgresRepository(pool);

  // Unique ids so the seed never collides with existing data and cleanup is exact.
  const contentId = randomUUID();
  const reportId = randomUUID();
  const urlHash = `migration-test-${randomUUID()}`;
  const now = new Date().toISOString();

  // A small but representative report payload — the JSONB render source of truth.
  const report: AnalysisReport = {
    id: reportId,
    contentId,
    urlHash,
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    tldr: 'seeded report for migration non-destructiveness test',
    claims: [
      {
        id: 'claim-1',
        claimText: 'A verifiable claim with one citation.',
        verifiability: 'verifiable',
        evidenceStrength: 'moderate',
        confidence: 0.8,
        citations: [
          {
            sourceUrl: 'https://example.org/a',
            sourceName: 'Example Org',
            sourceTier: 'tier2_institutional',
            supports: true,
          },
        ],
      },
      {
        id: 'claim-2',
        claimText: 'An honest none-state claim with zero citations.',
        verifiability: 'opinion',
        evidenceStrength: 'none',
        confidence: 0.7,
        citations: [],
      },
    ],
    framingSignals: [],
    contextCards: [],
    perspectives: [],
    confidence: 0.8,
    createdAt: now,
    updatedAt: now,
  };

  try {
    // Ensure the base schema exists (idempotent) so we can seed analysis_reports.
    await applyMigration(pool, '001_init.sql');
    await applyMigration(pool, '002_dispute_claim_id.sql');
    await applyMigration(pool, '003_audit_records.sql');

    // Seed BEFORE applying 004 — parameterized SQL only. The FK requires a
    // content_items row first.
    await pool.query(
      `INSERT INTO content_items (id, url_hash, source_type, source_url, title, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [contentId, urlHash, 'youtube', 'https://youtu.be/seed', 'Seed', JSON.stringify({}), now],
    );
    await pool.query(
      `INSERT INTO analysis_reports
         (id, content_id, status, version, producing_layer, tldr, confidence, share_slug, error, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        report.id, report.contentId, report.status, report.version, report.producingLayer,
        report.tldr ?? null, report.confidence ?? null, report.shareSlug ?? null, report.error ?? null,
        JSON.stringify(report), report.createdAt, report.updatedAt,
      ],
    );

    // Apply the migration under test. Idempotent (IF NOT EXISTS), so it is safe
    // whether or not the DB already had 004.
    await applyMigration(pool, '004_report_graph.sql');

    // ── Assert the new schema objects exist (Req 7.2) ──
    const col = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'claims' AND column_name = 'claim_uid'`,
    );
    assert.equal(col.rowCount, 1, 'claims.claim_uid column should exist after 004');

    const idx = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)`,
      [NEW_INDEXES],
    );
    const found = new Set(idx.rows.map((r) => r.indexname as string));
    for (const name of NEW_INDEXES) {
      assert.ok(found.has(name), `index ${name} should exist after 004`);
    }

    // ── Assert existing data + getReport are intact (Req 7.3) ──
    const raw = await pool.query(`SELECT data FROM analysis_reports WHERE id = $1`, [reportId]);
    assert.equal(raw.rowCount, 1, 'seeded analysis_reports row should survive 004');
    assert.deepEqual(raw.rows[0].data, report, 'JSONB payload should be unchanged by 004');

    const got = await repo.getReport(reportId);
    assert.ok(got, 'getReport should still return the seeded report after 004');
    assert.equal(got!.id, reportId);
    assert.equal(got!.tldr, report.tldr);
    assert.deepEqual(got!.claims, report.claims, 'claims payload should be intact');
  } finally {
    // Clean up the seeded rows (claims/citations cascade from analysis_reports).
    await pool.query(`DELETE FROM analysis_reports WHERE id = $1`, [reportId]).catch(() => {});
    await pool.query(`DELETE FROM content_items WHERE id = $1`, [contentId]).catch(() => {});
    await pool.end();
  }
});
