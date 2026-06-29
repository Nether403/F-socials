// Feature: accounts-save-history, Property 5: In-memory and Postgres repositories agree
// Validates: Requirements 11.2
//
// For any sequence of save/remove/list operations across multiple readers and
// reports, the InMemoryRepository (the model) and the PostgresRepository return
// equivalent results for identical inputs — the same membership and the same
// order — when each reader's history is listed.
//
// This is a Postgres integration test: it needs a real database. Without
// TEST_DATABASE_URL/DATABASE_URL it SKIPS cleanly (node:test skip), so the
// offline-first suite stays green with zero API keys / no database. Point it at
// a throwaway DB via TEST_DATABASE_URL (preferred) or DATABASE_URL. When a DB is
// present it applies migrations 001..006 (tolerating "already exists"), seeds a
// small FIXED pool of analysis_reports ONCE (reader_saved_reports.report_id has
// an FK to analysis_reports — saves can only target existing reports), then runs
// 100 generated op-sequences, each against a fresh InMemoryRepository and the
// shared PostgresRepository, asserting the listed history agrees per reader.
//
// Ordering parity, deterministically. Both repositories order a reader's history
// by (savedAt DESC, reportId DESC). They stamp savedAt independently: the
// in-memory repo from `new Date().toISOString()` (millisecond resolution, so two
// quick saves can TIE and then sort by reportId), Postgres from the column
// default `now()` (microsecond resolution across separate statements, so saves
// effectively never tie and stay in insertion order). Left to wall-clock timing
// those two orderings can legitimately diverge. To make the comparison total and
// flake-free we stamp the in-memory repo's saves from a strictly-increasing
// synthetic clock (one tick per fresh save), so the in-memory order is exactly
// the save-recency order — which is also Postgres's order. The two clocks have
// different absolute values, so we compare the reportId SEQUENCE (which encodes
// both membership and order), not the raw savedAt values. Idempotent re-saves
// touch neither clock (in-memory's `has` short-circuit / Postgres's ON CONFLICT
// DO NOTHING), so a report's timestamp reflects its first save since the last
// removal in BOTH — keeping recency aligned across re-save/after-remove cases.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import fc from 'fast-check';
import type { Pool } from 'pg';

import { InMemoryRepository } from '../src/infra/memory';
import { PostgresRepository, makePgPool } from '../src/infra/postgres';

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const skip = DB_URL
  ? false
  : 'no TEST_DATABASE_URL/DATABASE_URL — skipping Postgres integration test';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

// Apply every db/migrations/*.sql in lexical order (001..006), tolerating the
// "already exists" errors a reused test DB raises — mirrors scripts/migrate.mjs.
async function applyMigrations(pool: Pool): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    try {
      await pool.query(sql);
    } catch (e) {
      if (!/already exists/i.test((e as Error).message)) throw e;
    }
  }
}

// ── Synthetic strictly-increasing clock for the in-memory repo's saves ──
// FakeDate overrides only toISOString (the single Date use inside
// saveSavedReport), returning a fresh increasing instant per fresh save. tick is
// module-global → monotonic within every run. We swap globalThis.Date only
// around the in-memory save call (whose body runs synchronously up to the stamp,
// with no intervening await), so no other code observes the stub — Postgres
// never uses JS Date for saved_at, and listSavedReports' own `new Date(...)`
// parsing runs outside the stubbed window.
const CLOCK_BASE = Date.UTC(2020, 0, 1);
let tick = 0;
const RealDate = globalThis.Date;
class FakeDate extends RealDate {
  toISOString(): string {
    return new RealDate(CLOCK_BASE + tick++ * 1000).toISOString();
  }
}

async function memSave(mem: InMemoryRepository, reader: string, report: string): Promise<void> {
  globalThis.Date = FakeDate as DateConstructor;
  try {
    await mem.saveSavedReport(reader, report);
  } finally {
    globalThis.Date = RealDate;
  }
}

const READER_COUNT = 3;
const POOL_SIZE = 4;

// A generated op-sequence: each op picks one of READER_COUNT readers, one of the
// POOL_SIZE pre-seeded reports, and either saves or removes it. Drawing from
// small pools makes the same report frequently saved/removed by multiple readers
// — the case that would catch a leak or an ordering divergence between drivers.
const opsArb = fc.array(
  fc.record({
    readerIdx: fc.integer({ min: 0, max: READER_COUNT - 1 }),
    reportIdx: fc.integer({ min: 0, max: POOL_SIZE - 1 }),
    kind: fc.constantFrom('save' as const, 'remove' as const),
  }),
  { maxLength: 15 },
);

test('Property 5: in-memory and Postgres repositories agree on saved-report membership and order', { skip }, async () => {
  const pool = makePgPool(DB_URL as string);
  const pg = new PostgresRepository(pool);

  // One content row + a fixed pool of reports the saves can reference (FK).
  const contentId = randomUUID();
  const reportIds = Array.from({ length: POOL_SIZE }, () => randomUUID());
  const now = new Date().toISOString();

  try {
    await applyMigrations(pool);

    // Seed the FK targets once. Parameterized SQL only.
    await pool.query(
      `INSERT INTO content_items (id, url_hash, source_type, source_url, title, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [contentId, `parity-${contentId}`, 'youtube', 'https://youtu.be/seed', 'Seed', JSON.stringify({}), now],
    );
    for (const reportId of reportIds) {
      await pool.query(
        `INSERT INTO analysis_reports
           (id, content_id, status, version, producing_layer, tldr, confidence, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [reportId, contentId, 'ready', 1, 'ai', 'seeded report for parity test', 0.8,
         JSON.stringify({ id: reportId }), now, now],
      );
    }

    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        // Run-scoped reader ids so concurrent/sequential runs never collide and
        // cleanup is exact (reader_id is TEXT, no FK — any string is valid).
        const runId = randomUUID();
        const readers = Array.from({ length: READER_COUNT }, (_, i) => `parity-${runId}-r${i}`);
        const mem = new InMemoryRepository();

        try {
          // Identical op-sequence against BOTH repositories, in the same order.
          for (const op of ops) {
            const reader = readers[op.readerIdx]!;
            const report = reportIds[op.reportIdx]!;
            if (op.kind === 'save') {
              await memSave(mem, reader, report);
              await pg.saveSavedReport(reader, report);
            } else {
              await mem.removeSavedReport(reader, report);
              await pg.removeSavedReport(reader, report);
            }
          }

          // Every reader's history must agree on membership AND order. The
          // reportId sequence encodes both; absolute savedAt values differ by
          // construction (independent clocks) and are intentionally not compared.
          for (const reader of readers) {
            const memList = await mem.listSavedReports(reader);
            const pgList = await pg.listSavedReports(reader);
            assert.deepEqual(
              pgList.map((e) => e.reportId),
              memList.map((e) => e.reportId),
              `Postgres and in-memory disagree on reader ${reader}'s history`,
            );
          }
        } finally {
          // Drop this run's saved rows (run-unique reader ids → exact scope).
          await pool.query(`DELETE FROM reader_saved_reports WHERE reader_id = ANY($1)`, [readers]).catch(() => {});
        }
      }),
      { numRuns: 100 },
    );
  } finally {
    // content_items delete cascades to analysis_reports → reader_saved_reports.
    await pool.query('DELETE FROM content_items WHERE id = $1', [contentId]).catch(() => {});
    await pool.end();
  }
});
