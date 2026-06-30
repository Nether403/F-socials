// Feature: supabase-user-sync — Postgres migration integration test (task 5.2).
//
// Migration 009_user_sync.sql is the narrowest possible, data-preserving change:
// `ALTER TABLE users ALTER COLUMN email DROP NOT NULL`, so a Supabase user synced
// from verified JWT claims that omit an email is storable with email NULL (Req
// 5.1). This test seeds a populated database (a users row + a content_item + an
// analysis_report + a flag), applies 009 TWICE, then asserts (a) neither apply
// throws — DROP NOT NULL is idempotent (Req 9.2), (b) users.email is nullable
// afterwards (information_schema.columns.is_nullable = 'YES') (Req 9.1), and (c)
// every seeded row is preserved byte-for-byte (captured before, compared after)
// — the migration alters column nullability only, never data (Req 9.3).
//
// A separate, DB-free test asserts the lexical apply order: 009_user_sync.sql
// sorts immediately after 008_intervention_and_scale.sql, which is exactly the
// order scripts/migrate.mjs applies them in (readdirSync().filter('.sql').sort())
// (Req 9.4).
//
// The DB-backed test REQUIRES a real Postgres. Without a connection string it
// SKIPS cleanly (node:test `{ skip }`), so the offline-first suite stays green
// with zero API keys / no database. Point it at a throwaway DB via
// TEST_DATABASE_URL (preferred) or DATABASE_URL. It mirrors scripts/migrate.mjs:
// it applies the base migrations (001–008) swallowing "already exists" so the
// schema is present whether the DB is fresh or already migrated, then applies 009.
//
// Cleanup deletes ONLY the rows this test seeded (tracked by their unique ids) and
// does NOT revert the email-nullability change — that change is data-preserving and
// idempotent, so leaving it applied keeps cleanup re-runnable without touching any
// pre-existing data.
//
// Validates: Requirements 9.1, 9.2, 9.3, 9.4

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { makePgPool } from '../src/infra/postgres';
import type { AnalysisReport } from '../src/types';

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

function readMigration(file: string): string {
  return readFileSync(resolve(migrationsDir, file), 'utf8');
}

// Apply a migration file, swallowing "already exists" so a DB that has already
// been migrated is fine (mirrors scripts/migrate.mjs). Also swallows the
// concurrent-race equivalent: a unique_violation (23505) on a Postgres system
// catalog (pg_extension / pg_type / …) that surfaces when two migration runs
// apply the same CREATE EXTENSION/TYPE to one shared DB at once. Re-throws
// anything else.
async function applyMigration(pool: import('pg').Pool, file: string): Promise<void> {
  try {
    await pool.query(readMigration(file));
  } catch (e) {
    const err = e as { message?: string; code?: string; table?: string };
    const alreadyExists =
      /already exists/i.test(err?.message ?? '') ||
      (err?.code === '23505' && (err?.table ?? '').startsWith('pg_'));
    if (!alreadyExists) throw e;
  }
}

// ── (Req 9.4) Lexical apply order — DB-free, always runs. ──
// scripts/migrate.mjs applies migrations via readdirSync().filter('.sql').sort(),
// so this filename-level check is exactly the apply order. We assert 009 sorts
// immediately after 008 with nothing in between.
test('migration 009 applies in lexical order immediately after 008', () => {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // same ordering scripts/migrate.mjs uses

  const idx008 = files.indexOf('008_intervention_and_scale.sql');
  const idx009 = files.indexOf('009_user_sync.sql');

  assert.ok(idx008 >= 0, '008_intervention_and_scale.sql should be present');
  assert.ok(idx009 >= 0, '009_user_sync.sql should be present');
  assert.ok(idx009 > idx008, '009 should apply AFTER 008 in lexical order (Req 9.4)');
  assert.equal(idx009, idx008 + 1, '009 should apply IMMEDIATELY after 008 (no migration between)');
  // 009 also sorts last overall, so the runner applies it after every existing migration.
  assert.equal(files[files.length - 1], '009_user_sync.sql', '009 sorts after every existing migration (Req 9.4)');
});

test('migration 009 relaxes users.email to nullable, re-runs cleanly, and preserves seeded rows', { skip: !DB_URL }, async () => {
  const pool = makePgPool(DB_URL as string);

  // Unique ids so the seed never collides with existing data and cleanup is exact.
  const userId = randomUUID();
  const contentId = randomUUID();
  const reportId = randomUUID();
  const urlHash = `usersync-migration-test-${randomUUID()}`;
  const userEmail = `reader-${userId}@example.test`;
  const now = new Date().toISOString();

  // A small but representative report payload — the JSONB render source of truth.
  const report: AnalysisReport = {
    id: reportId,
    contentId,
    urlHash,
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    tldr: 'seeded report for 009 migration non-destructiveness test',
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
  const flagNote = 'seeded flag note — must survive 009';

  try {
    // Ensure the full base schema exists (idempotent) so we can seed pre-existing
    // rows. Apply the whole 001–008 chain in order, exactly like migrate.mjs.
    await applyMigration(pool, '001_init.sql');
    await applyMigration(pool, '002_dispute_claim_id.sql');
    await applyMigration(pool, '003_audit_records.sql');
    await applyMigration(pool, '004_report_graph.sql');
    await applyMigration(pool, '005_review_workflow.sql');
    await applyMigration(pool, '006_saved_reports.sql');
    await applyMigration(pool, '007_workspaces.sql');
    await applyMigration(pool, '008_intervention_and_scale.sql');

    // Seed BEFORE applying 009 — parameterized SQL only. A users row (the table
    // 009 alters) plus an FK chain: content_item → analysis_report → flag.
    await pool.query(
      `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`,
      [userId, userEmail, 'Seed Reader'],
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

    // ── Capture every seeded row BEFORE the migration (Req 9.3 baseline). ──
    const userBefore = (await pool.query(`SELECT * FROM users WHERE id = $1`, [userId])).rows[0];
    const contentBefore = (await pool.query(`SELECT * FROM content_items WHERE id = $1`, [contentId])).rows[0];
    const reportBefore = (await pool.query(`SELECT * FROM analysis_reports WHERE id = $1`, [reportId])).rows[0];
    const flagBefore = (await pool.query(`SELECT * FROM flags WHERE report_id = $1`, [reportId])).rows[0];
    assert.ok(userBefore && contentBefore && reportBefore && flagBefore, 'all four seed rows present before 009');

    // Sanity: email starts NOT NULL (the pre-009 schema constraint we relax).
    const nullableBefore = await pool.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'email'`,
    );
    assert.equal(nullableBefore.rows[0]?.is_nullable, 'NO', 'users.email starts NOT NULL before 009');

    // ── Apply 009 TWICE — neither application throws (Req 9.2 idempotent). ──
    await assert.doesNotReject(
      pool.query(readMigration('009_user_sync.sql')),
      'first apply of 009 should not throw',
    );
    await assert.doesNotReject(
      pool.query(readMigration('009_user_sync.sql')),
      're-applying 009 should not throw (DROP NOT NULL is idempotent, Req 9.2)',
    );

    // ── (a) users.email is nullable afterwards (Req 9.1). ──
    const nullableAfter = await pool.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'email'`,
    );
    assert.equal(nullableAfter.rows[0]?.is_nullable, 'YES', 'users.email should be nullable after 009 (Req 9.1)');

    // The UNIQUE(email) index is left intact — the column is neither dropped,
    // renamed, nor retyped; only its NOT NULL constraint is relaxed (Req 9.1).
    const emailCol = await pool.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'email'`,
    );
    assert.equal(emailCol.rows[0]?.data_type, 'text', 'users.email type unchanged (still text) after 009');

    // ── (b) Every seeded row preserved byte-for-byte (Req 9.3). ──
    const userAfter = (await pool.query(`SELECT * FROM users WHERE id = $1`, [userId])).rows[0];
    const contentAfter = (await pool.query(`SELECT * FROM content_items WHERE id = $1`, [contentId])).rows[0];
    const reportAfter = (await pool.query(`SELECT * FROM analysis_reports WHERE id = $1`, [reportId])).rows[0];
    const flagAfter = (await pool.query(`SELECT * FROM flags WHERE report_id = $1`, [reportId])).rows[0];

    assert.deepEqual(userAfter, userBefore, 'seeded users row unchanged by 009 (Req 9.3)');
    assert.deepEqual(contentAfter, contentBefore, 'seeded content_items row unchanged by 009 (Req 9.3)');
    assert.deepEqual(reportAfter, reportBefore, 'seeded analysis_reports row unchanged by 009 (Req 9.3)');
    assert.deepEqual(flagAfter, flagBefore, 'seeded flag row unchanged by 009 (Req 9.3)');

    // Spot-check the relaxed-constraint payoff: a SECOND user with a NULL email is
    // now insertable (the whole point of 009), and distinct NULLs do not collide
    // under UNIQUE(email). Tracked for cleanup via its own id.
    const nullEmailUserId = randomUUID();
    await assert.doesNotReject(
      pool.query(`INSERT INTO users (id, email, display_name) VALUES ($1, NULL, $2)`, [nullEmailUserId, 'No Email']),
      'a user with NULL email is insertable after 009',
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [nullEmailUserId]).catch(() => {});
  } finally {
    // Clean up ONLY the rows this test seeded (tracked ids). flags cascade from
    // analysis_reports; delete in FK-safe order regardless. We deliberately do NOT
    // revert the email-nullability change — it is data-preserving and idempotent,
    // so re-runs stay clean and no pre-existing data is touched.
    await pool.query(`DELETE FROM flags WHERE report_id = $1`, [reportId]).catch(() => {});
    await pool.query(`DELETE FROM analysis_reports WHERE id = $1`, [reportId]).catch(() => {});
    await pool.query(`DELETE FROM content_items WHERE id = $1`, [contentId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    await pool.end();
  }
});
