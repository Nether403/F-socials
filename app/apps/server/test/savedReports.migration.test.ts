// Feature: accounts-save-history — Postgres migration integration test (task 4.4).
//
// Migration 006_saved_reports.sql is additive and non-destructive: seed a
// populated database (content_item + analysis_report + a flag, each in tables
// 006 does NOT touch), apply 006, then assert (a) the new reader_saved_reports
// table + its listing index exist, (b) every pre-existing row is preserved
// byte-for-byte, (c) existing route response shapes are unchanged
// (PostgresRepository.getReport returns the seeded report intact), (d) the new
// store round-trips through the Repository methods, and (e) a second apply is a
// no-op (IF NOT EXISTS).
//
// A separate, DB-free test asserts the lexical apply order: 006_saved_reports.sql
// sorts immediately after 005_review_workflow.sql, which is exactly the order
// scripts/migrate.mjs applies them in (readdirSync().filter('.sql').sort()).
//
// The DB-backed test REQUIRES a real Postgres. Without a connection string it
// SKIPS cleanly (node:test `{ skip }`), so the offline-first suite stays green
// with zero API keys / no database. Point it at a throwaway DB via
// TEST_DATABASE_URL (preferred) or DATABASE_URL. It mirrors scripts/migrate.mjs:
// it applies the base migrations (001–005) swallowing "already exists" so the
// schema is present whether the DB is fresh or already migrated, then applies 006.
//
// Validates: Requirements 11.3, 11.4

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { makePgPool, PostgresRepository } from '../src/infra/postgres';
import type { AnalysisReport } from '../src/types';

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

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

// ── (Req 11.4) Lexical apply order — DB-free, always runs. ──
// scripts/migrate.mjs applies migrations via readdirSync().filter('.sql').sort(),
// so this filename-level check is exactly the apply order. We assert 006 sorts
// immediately after 005 with nothing in between.
test('migration 006 applies in lexical order immediately after 005', () => {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // same ordering scripts/migrate.mjs uses

  const idx005 = files.indexOf('005_review_workflow.sql');
  const idx006 = files.indexOf('006_saved_reports.sql');

  assert.ok(idx005 >= 0, '005_review_workflow.sql should be present');
  assert.ok(idx006 >= 0, '006_saved_reports.sql should be present');
  assert.ok(idx006 > idx005, '006 should apply AFTER 005 in lexical order (Req 11.4)');
  assert.equal(idx006, idx005 + 1, '006 should apply IMMEDIATELY after 005 (no migration between)');
});

test('migration 006 adds reader_saved_reports, is non-destructive, and re-runs as a no-op', { skip: !DB_URL }, async () => {
  const pool = makePgPool(DB_URL as string);
  const repo = new PostgresRepository(pool);

  // Unique ids so the seed never collides with existing data and cleanup is exact.
  const userId = randomUUID();
  const contentId = randomUUID();
  const reportId = randomUUID();
  const urlHash = `saved-migration-test-${randomUUID()}`;
  const readerId = `reader-${randomUUID()}`; // Supabase JWT subject (TEXT)
  const now = new Date().toISOString();

  // A small but representative report payload — the JSONB render source of truth
  // and the shape returned by the existing GET /analyses/:id route.
  const report: AnalysisReport = {
    id: reportId,
    contentId,
    urlHash,
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    tldr: 'seeded report for 006 migration non-destructiveness test',
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
    ],
    framingSignals: [],
    contextCards: [],
    perspectives: [],
    confidence: 0.8,
    createdAt: now,
    updatedAt: now,
  };

  const flagTechnique = 'loaded_language';
  const flagNote = 'seeded flag note — must survive 006';

  try {
    // Ensure the full base schema exists (idempotent) so we can seed pre-existing
    // rows in tables 006 does not touch. 006 only depends on analysis_reports, but
    // we apply the whole 001–005 chain in order, exactly like migrate.mjs.
    await applyMigration(pool, '001_init.sql');
    await applyMigration(pool, '002_dispute_claim_id.sql');
    await applyMigration(pool, '003_audit_records.sql');
    await applyMigration(pool, '004_report_graph.sql');
    await applyMigration(pool, '005_review_workflow.sql');

    // Seed BEFORE applying 006 — parameterized SQL only. FK chain: a user (for the
    // flag), a content_item, an analysis_report, then a flag row.
    await pool.query(
      `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`,
      [userId, `reader-${userId}@example.test`, 'Seed Reader'],
    );
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
        report.tldr ?? null, report.confidence ?? null, null, null,
        JSON.stringify(report), report.createdAt, report.updatedAt,
      ],
    );
    await pool.query(
      `INSERT INTO flags (id, report_id, user_id, technique, note)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [reportId, userId, flagTechnique, flagNote],
    );

    // ── Apply the migration under test (Req 11.3). Idempotent (IF NOT EXISTS). ──
    await applyMigration(pool, '006_saved_reports.sql');

    // ── (a) The new table + listing index exist (Req 11.3 additive object) ──
    const tbl = await pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_name = 'reader_saved_reports'`,
    );
    assert.equal(tbl.rowCount, 1, 'reader_saved_reports table should exist after 006');

    const idx = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reader_saved_reports_listing'`,
    );
    assert.equal(idx.rowCount, 1, 'idx_reader_saved_reports_listing index should exist after 006');

    // ── (b) Pre-existing rows preserved across tables 006 does not touch (Req 11.3) ──
    const content = await pool.query(`SELECT url_hash FROM content_items WHERE id = $1`, [contentId]);
    assert.equal(content.rowCount, 1, 'seeded content_items row should survive 006');
    assert.equal(content.rows[0].url_hash, urlHash, 'content_items.url_hash unchanged by 006');

    const flag = await pool.query(
      `SELECT technique, note, review_status FROM flags WHERE report_id = $1`,
      [reportId],
    );
    assert.equal(flag.rowCount, 1, 'seeded flag row should survive 006');
    assert.equal(flag.rows[0].technique, flagTechnique, 'flag.technique unchanged by 006');
    assert.equal(flag.rows[0].note, flagNote, 'flag.note unchanged by 006');
    assert.equal(flag.rows[0].review_status, 'pending', '005 review_status column unchanged by 006');

    // ── (c) Existing route response shapes unchanged: the JSONB payload and the
    //        PostgresRepository.getReport projection are byte-for-byte intact (Req 11.3) ──
    const raw = await pool.query(`SELECT data FROM analysis_reports WHERE id = $1`, [reportId]);
    assert.equal(raw.rowCount, 1, 'seeded analysis_reports row should survive 006');
    assert.deepEqual(raw.rows[0].data, report, 'analysis_reports JSONB payload unchanged by 006');

    const got = await repo.getReport(reportId);
    assert.ok(got, 'getReport should still return the seeded report after 006');
    assert.deepEqual(got, report, 'GET /analyses/:id response shape unchanged by 006');

    // ── (d) The new store round-trips through the Repository methods (additive
    //        functionality wired correctly): save → list returns the entry. ──
    await repo.saveSavedReport(readerId, reportId);
    const saved = await repo.listSavedReports(readerId);
    assert.equal(saved.length, 1, 'one saved entry after a save');
    const entry = saved[0];
    assert.ok(entry, 'listed entry should be present');
    assert.equal(entry.reportId, reportId, 'listed entry references the saved report');
    assert.equal(typeof entry.savedAt, 'string', 'savedAt projected as ISO 8601 string');
    // Reader-scoped: a different reader sees nothing (Req 11.8 spot-check).
    const otherReader = await repo.listSavedReports(`reader-${randomUUID()}`);
    assert.deepEqual(otherReader, [], 'a different reader has no saved entries');

    // ── (e) Re-run is a no-op: a SECOND raw apply throws nothing, table intact. ──
    await assert.doesNotReject(
      pool.query(readMigration('006_saved_reports.sql')),
      're-applying 006 should not throw (IF NOT EXISTS)',
    );
    const afterRerun = await repo.listSavedReports(readerId);
    assert.equal(afterRerun.length, 1, 'saved entry unchanged after a 006 re-run');
  } finally {
    // Clean up the seeded rows. reader_saved_reports + flags cascade from
    // analysis_reports (ON DELETE CASCADE); delete in FK-safe order regardless.
    await pool.query(`DELETE FROM reader_saved_reports WHERE reader_id = $1`, [readerId]).catch(() => {});
    await pool.query(`DELETE FROM analysis_reports WHERE id = $1`, [reportId]).catch(() => {});
    await pool.query(`DELETE FROM content_items WHERE id = $1`, [contentId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    await pool.end();
  }
});
