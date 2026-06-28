// Feature: expert-review-queue — Postgres integration test (task 2.2).
//
// Migration 005 applies cleanly and is non-destructive + re-run-safe: seed a
// dispute and a flag, apply 005_review_workflow.sql, then assert it (a) added
// the six review columns to BOTH disputes and flags, (b) created the two enum
// types, (c) preserved the seeded rows, (d) set every existing row's
// review_status to the 'pending' column default, and (e) is a no-op on re-run
// (a second apply throws nothing and leaves state unchanged).
//
// This test REQUIRES a real Postgres. Without a connection string it SKIPS
// cleanly (node:test `{ skip }`), so the offline-first suite stays green with
// zero API keys / no database. Point it at a throwaway DB via TEST_DATABASE_URL
// (preferred) or DATABASE_URL. It mirrors scripts/migrate.mjs: it applies the
// base migrations (001–004) swallowing "already exists" so the schema is
// present whether the DB is fresh or already migrated, then applies 005.
//
// Validates: Requirements 7.1, 7.2, 7.3, 7.5, 7.6

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { makePgPool } from '../src/infra/postgres';

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

// The six additive review columns 005 adds to BOTH disputes and flags.
const NEW_COLUMNS = [
  'review_status',
  'assigned_reviewer',
  'resolution_outcome',
  'resolution_note',
  'resolved_by',
  'review_resolved_at',
];

// The two enum types 005 introduces.
const NEW_ENUMS = ['review_status_kind', 'resolution_outcome'];

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

// Assert every NEW_COLUMNS column exists on `table`.
async function assertColumns(pool: import('pg').Pool, table: string): Promise<void> {
  const res = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND column_name = ANY($2)`,
    [table, NEW_COLUMNS],
  );
  const found = new Set(res.rows.map((r) => r.column_name as string));
  for (const name of NEW_COLUMNS) {
    assert.ok(found.has(name), `${table}.${name} column should exist after 005`);
  }
}

test('migration 005 adds review columns/enums, is non-destructive, and re-runs as a no-op', { skip: !DB_URL }, async () => {
  const pool = makePgPool(DB_URL as string);

  // Unique ids so the seed never collides with existing data and cleanup is exact.
  const userId = randomUUID();
  const contentId = randomUUID();
  const reportId = randomUUID();
  const urlHash = `review-migration-test-${randomUUID()}`;
  const now = new Date().toISOString();

  try {
    // Ensure the base schema exists (idempotent) so we can seed the tables 005
    // alters. 004 is part of the in-order chain even though 005 doesn't need it.
    await applyMigration(pool, '001_init.sql');
    await applyMigration(pool, '002_dispute_claim_id.sql');
    await applyMigration(pool, '003_audit_records.sql');
    await applyMigration(pool, '004_report_graph.sql');

    // Seed BEFORE applying 005 — parameterized SQL only. The FK chain requires a
    // user (for the flag), a content_item, and an analysis_report first.
    await pool.query(
      `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`,
      [userId, `reviewer-${userId}@example.test`, 'Seed Reviewer'],
    );
    await pool.query(
      `INSERT INTO content_items (id, url_hash, source_type, source_url, title, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [contentId, urlHash, 'youtube', 'https://youtu.be/seed', 'Seed', JSON.stringify({}), now],
    );
    await pool.query(
      `INSERT INTO analysis_reports
         (id, content_id, status, version, producing_layer, tldr, confidence, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [reportId, contentId, 'ready', 1, 'ai', 'seeded report for 005 migration test', 0.8,
       JSON.stringify({ id: reportId }), now, now],
    );
    // Anonymous dispute (raised_by NULL) + authenticated flag (user_id required).
    const disputeReason = 'seeded dispute reason — must survive 005';
    await pool.query(
      `INSERT INTO disputes (id, report_id, reason) VALUES (gen_random_uuid(), $1, $2)`,
      [reportId, disputeReason],
    );
    const flagTechnique = 'loaded_language';
    await pool.query(
      `INSERT INTO flags (id, report_id, user_id, technique, note)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [reportId, userId, flagTechnique, 'seeded flag note — must survive 005'],
    );

    // ── Apply the migration under test (Req 7.1) ──
    await applyMigration(pool, '005_review_workflow.sql');

    // ── (a) The six review columns exist on BOTH tables (Req 7.2) ──
    await assertColumns(pool, 'disputes');
    await assertColumns(pool, 'flags');

    // ── review_status is NOT NULL DEFAULT 'pending' on both tables (Req 7.2) ──
    for (const table of ['disputes', 'flags']) {
      const meta = await pool.query(
        `SELECT is_nullable, column_default FROM information_schema.columns
          WHERE table_name = $1 AND column_name = 'review_status'`,
        [table],
      );
      assert.equal(meta.rowCount, 1, `${table}.review_status should exist`);
      assert.equal(meta.rows[0].is_nullable, 'NO', `${table}.review_status should be NOT NULL`);
      assert.match(
        String(meta.rows[0].column_default),
        /pending/,
        `${table}.review_status default should be 'pending'`,
      );
    }

    // ── (b) Both enum types exist (Req 7.2) ──
    const enums = await pool.query(`SELECT typname FROM pg_type WHERE typname = ANY($1)`, [NEW_ENUMS]);
    const foundEnums = new Set(enums.rows.map((r) => r.typname as string));
    for (const name of NEW_ENUMS) {
      assert.ok(foundEnums.has(name), `enum type ${name} should exist after 005`);
    }

    // ── (c)+(d) Seeded rows survive AND default to review_status='pending' (Req 7.3, 7.5) ──
    const dispute = await pool.query(
      `SELECT reason, review_status, assigned_reviewer, resolution_outcome
         FROM disputes WHERE report_id = $1`,
      [reportId],
    );
    assert.equal(dispute.rowCount, 1, 'seeded dispute row should survive 005');
    assert.equal(dispute.rows[0].reason, disputeReason, 'dispute.reason should be unchanged by 005');
    assert.equal(dispute.rows[0].review_status, 'pending', 'existing dispute should default to pending (Req 7.5)');
    assert.equal(dispute.rows[0].assigned_reviewer, null, 'unassigned dispute should have null reviewer');
    assert.equal(dispute.rows[0].resolution_outcome, null, 'unresolved dispute should have null outcome');

    const flag = await pool.query(
      `SELECT technique, review_status, assigned_reviewer, resolution_outcome
         FROM flags WHERE report_id = $1`,
      [reportId],
    );
    assert.equal(flag.rowCount, 1, 'seeded flag row should survive 005');
    assert.equal(flag.rows[0].technique, flagTechnique, 'flag.technique should be unchanged by 005');
    assert.equal(flag.rows[0].review_status, 'pending', 'existing flag should default to pending (Req 7.5)');
    assert.equal(flag.rows[0].assigned_reviewer, null, 'unassigned flag should have null reviewer');
    assert.equal(flag.rows[0].resolution_outcome, null, 'unresolved flag should have null outcome');

    // ── (e) Re-run is a no-op: a SECOND raw apply throws nothing, state unchanged (Req 7.6) ──
    // Apply directly (not via the already-exists-swallowing helper) so any error
    // from a non-idempotent statement would surface here.
    await assert.doesNotReject(
      pool.query(readMigration('005_review_workflow.sql')),
      're-applying 005 should not throw (Req 7.6)',
    );
    const afterRerun = await pool.query(
      `SELECT review_status FROM disputes WHERE report_id = $1`,
      [reportId],
    );
    assert.equal(afterRerun.rows[0].review_status, 'pending', 'review_status unchanged after re-run (Req 7.6)');
  } finally {
    // Clean up the seeded rows (disputes/flags cascade from analysis_reports).
    await pool.query(`DELETE FROM analysis_reports WHERE id = $1`, [reportId]).catch(() => {});
    await pool.query(`DELETE FROM content_items WHERE id = $1`, [contentId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    await pool.end();
  }
});
