// Feature: institutional-workspace — Postgres migration integration test (task 4.4).
//
// Migration 007_workspaces.sql is additive and non-destructive: seed a populated
// database (content_item + analysis_report + a flag + a 006 reader_saved_reports
// row, each in tables 007 does NOT touch), apply 007, then assert (a) the six new
// tables — workspaces, workspace_members, workspace_invites, shared_collections,
// collection_items, annotations — and the four new indexes —
// idx_workspace_members_reader, idx_shared_collections_workspace,
// idx_collection_items_listing, idx_annotations_listing — all exist, (b) every
// pre-existing row is preserved byte-for-byte, (c) existing route response shapes
// are unchanged (PostgresRepository.getReport returns the seeded report intact and
// prior tables' columns are untouched), (d) the new workspace store round-trips
// through the Repository methods, and (e) a second apply is a no-op (IF NOT EXISTS).
//
// A separate, DB-free test asserts the lexical apply order: 007_workspaces.sql
// sorts immediately after 006_saved_reports.sql, which is exactly the order
// scripts/migrate.mjs applies them in (readdirSync().filter('.sql').sort()).
//
// The DB-backed test REQUIRES a real Postgres. Without a connection string it
// SKIPS cleanly (node:test `{ skip }`), so the offline-first suite stays green
// with zero API keys / no database. Point it at a throwaway DB via
// TEST_DATABASE_URL (preferred) or DATABASE_URL. It mirrors scripts/migrate.mjs:
// it applies the base migrations (001–006) swallowing "already exists" so the
// schema is present whether the DB is fresh or already migrated, then applies 007.
//
// Validates: Requirements 9.3, 9.4

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

// The six tables and four indexes 007 introduces (Req 9.3 additive objects).
const NEW_TABLES = [
  'workspaces',
  'workspace_members',
  'workspace_invites',
  'shared_collections',
  'collection_items',
  'annotations',
] as const;
const NEW_INDEXES = [
  'idx_workspace_members_reader',
  'idx_shared_collections_workspace',
  'idx_collection_items_listing',
  'idx_annotations_listing',
] as const;

// ── (Req 9.4) Lexical apply order — DB-free, always runs. ──
// scripts/migrate.mjs applies migrations via readdirSync().filter('.sql').sort(),
// so this filename-level check is exactly the apply order. We assert 007 sorts
// immediately after 006 with nothing in between.
test('migration 007 applies in lexical order immediately after 006', () => {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // same ordering scripts/migrate.mjs uses

  const idx006 = files.indexOf('006_saved_reports.sql');
  const idx007 = files.indexOf('007_workspaces.sql');

  assert.ok(idx006 >= 0, '006_saved_reports.sql should be present');
  assert.ok(idx007 >= 0, '007_workspaces.sql should be present');
  assert.ok(idx007 > idx006, '007 should apply AFTER 006 in lexical order (Req 9.4)');
  assert.equal(idx007, idx006 + 1, '007 should apply IMMEDIATELY after 006 (no migration between)');
});

test('migration 007 adds workspace tables, is non-destructive, and re-runs as a no-op', { skip: !DB_URL }, async () => {
  const pool = makePgPool(DB_URL as string);
  const repo = new PostgresRepository(pool);

  // Unique ids so the seed never collides with existing data and cleanup is exact.
  const userId = randomUUID();
  const contentId = randomUUID();
  const reportId = randomUUID();
  const urlHash = `workspace-migration-test-${randomUUID()}`;
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
    tldr: 'seeded report for 007 migration non-destructiveness test',
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
  const flagNote = 'seeded flag note — must survive 007';

  try {
    // Ensure the full base schema exists (idempotent) so we can seed pre-existing
    // rows in tables 007 does not touch. 007 only depends on analysis_reports, but
    // we apply the whole 001–006 chain in order, exactly like migrate.mjs.
    await applyMigration(pool, '001_init.sql');
    await applyMigration(pool, '002_dispute_claim_id.sql');
    await applyMigration(pool, '003_audit_records.sql');
    await applyMigration(pool, '004_report_graph.sql');
    await applyMigration(pool, '005_review_workflow.sql');
    await applyMigration(pool, '006_saved_reports.sql');

    // Seed BEFORE applying 007 — parameterized SQL only. FK chain: a user (for the
    // flag), a content_item, an analysis_report, then a flag row, then a 006
    // reader_saved_reports row.
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
    // A 006 saved-report row — proves the immediately-prior migration's data also
    // survives the additive 007.
    await repo.saveSavedReport(readerId, reportId);

    // ── Apply the migration under test (Req 9.3). Idempotent (IF NOT EXISTS). ──
    await applyMigration(pool, '007_workspaces.sql');

    // ── (a) The six new tables exist (Req 9.3 additive objects) ──
    for (const table of NEW_TABLES) {
      const r = await pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
        [table],
      );
      assert.equal(r.rowCount, 1, `${table} table should exist after 007`);
    }

    // ── (a) The four new indexes exist (Req 9.3 additive objects) ──
    for (const index of NEW_INDEXES) {
      const r = await pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [index]);
      assert.equal(r.rowCount, 1, `${index} index should exist after 007`);
    }

    // ── (b) Pre-existing rows preserved across tables 007 does not touch (Req 9.3) ──
    const content = await pool.query(`SELECT url_hash FROM content_items WHERE id = $1`, [contentId]);
    assert.equal(content.rowCount, 1, 'seeded content_items row should survive 007');
    assert.equal(content.rows[0].url_hash, urlHash, 'content_items.url_hash unchanged by 007');

    const flag = await pool.query(
      `SELECT technique, note, review_status FROM flags WHERE report_id = $1`,
      [reportId],
    );
    assert.equal(flag.rowCount, 1, 'seeded flag row should survive 007');
    assert.equal(flag.rows[0].technique, flagTechnique, 'flag.technique unchanged by 007');
    assert.equal(flag.rows[0].note, flagNote, 'flag.note unchanged by 007');
    assert.equal(flag.rows[0].review_status, 'pending', '005 review_status column unchanged by 007');

    const savedBefore = await repo.listSavedReports(readerId);
    assert.equal(savedBefore.length, 1, '006 reader_saved_reports row should survive 007');
    assert.equal(savedBefore[0]?.reportId, reportId, 'saved entry still references the report after 007');

    // ── (c) Existing route response shapes unchanged: the JSONB payload and the
    //        PostgresRepository.getReport projection are byte-for-byte intact (Req 9.3) ──
    const raw = await pool.query(`SELECT data FROM analysis_reports WHERE id = $1`, [reportId]);
    assert.equal(raw.rowCount, 1, 'seeded analysis_reports row should survive 007');
    assert.deepEqual(raw.rows[0].data, report, 'analysis_reports JSONB payload unchanged by 007');

    const got = await repo.getReport(reportId);
    assert.ok(got, 'getReport should still return the seeded report after 007');
    assert.deepEqual(got, report, 'GET /analyses/:id response shape unchanged by 007');

    // ── (d) The new workspace store round-trips through the Repository methods
    //        (additive functionality wired correctly): create workspace → owner
    //        membership listed; collection + item round-trip; annotation round-trip. ──
    const ws = await repo.createWorkspace(readerId, 'Seed Workspace');
    assert.equal(ws.role, 'owner', 'creator is the owner');
    const workspaces = await repo.listWorkspacesForReader(readerId);
    assert.equal(workspaces.length, 1, 'creator sees exactly the one workspace');
    assert.equal(workspaces[0]?.id, ws.id, 'listed workspace matches the created one');

    const col = await repo.createCollection(ws.id, 'Seed Collection');
    await repo.addCollectionItem(col.id, reportId);
    const items = await repo.listCollectionItems(col.id);
    assert.equal(items.length, 1, 'one collection item after an add');
    assert.equal(items[0]?.reportId, reportId, 'collection item references the seeded report');

    const ann = await repo.createAnnotation({
      workspaceId: ws.id,
      reportId,
      authorId: readerId,
      text: 'a reader-authored note',
    });
    const annotations = await repo.listAnnotations(ws.id, reportId);
    assert.equal(annotations.length, 1, 'one annotation after create');
    assert.equal(annotations[0]?.id, ann.id, 'listed annotation matches the created one');

    // ── (e) Re-run is a no-op: a SECOND raw apply throws nothing, tables intact. ──
    await assert.doesNotReject(
      pool.query(readMigration('007_workspaces.sql')),
      're-applying 007 should not throw (IF NOT EXISTS)',
    );
    const workspacesAfter = await repo.listWorkspacesForReader(readerId);
    assert.equal(workspacesAfter.length, 1, 'workspace data unchanged after a 007 re-run');
  } finally {
    // Clean up the seeded rows. Workspace children (members, invites, collections,
    // collection_items, annotations) cascade from workspaces; reader_saved_reports
    // and flags cascade from analysis_reports. Delete in FK-safe order regardless.
    await pool.query(`DELETE FROM workspaces WHERE owner_id = $1`, [readerId]).catch(() => {});
    await pool.query(`DELETE FROM reader_saved_reports WHERE reader_id = $1`, [readerId]).catch(() => {});
    await pool.query(`DELETE FROM analysis_reports WHERE id = $1`, [reportId]).catch(() => {});
    await pool.query(`DELETE FROM content_items WHERE id = $1`, [contentId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    await pool.end();
  }
});
