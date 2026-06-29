// Feature: institutional-workspace, Property 12: In-memory and Postgres repositories agree
// Validates: Requirements 9.2
//
// For any sequence of workspace / membership / invite / collection /
// collection-item / annotation operations, the InMemoryRepository (the model)
// and the PostgresRepository return EQUIVALENT observable results for identical
// logical inputs (Req 9.2). The two drivers generate their own UUIDs and invite
// codes, so this test never compares raw ids: it drives both repositories
// through the SAME logical operation sequence, threads each repo's returned ids
// through parallel per-repo handle registries, and then compares the OBSERVABLE
// reads in an id-agnostic way — returned roles, membership presence/absence,
// list contents and orderings, idempotency outcomes, and undefined-vs-present
// reads — exactly the shapes a caller can actually see.
//
// This is a Postgres integration test: it needs a real database. Without
// TEST_DATABASE_URL/DATABASE_URL it SKIPS cleanly (node:test skip), so the
// offline-first suite stays green with zero API keys / no database. Point it at
// a throwaway DB via TEST_DATABASE_URL (preferred) or DATABASE_URL. When a DB is
// present it applies migrations 001..007 (tolerating "already exists"), seeds a
// small FIXED pool of analysis_reports ONCE via repo.saveReport on BOTH repos —
// collection_items.report_id and annotations.report_id both FK to
// analysis_reports(id), so a report must exist before it can be collected or
// annotated — then runs 100 generated op-sequences, each against a fresh
// InMemoryRepository and the shared PostgresRepository, asserting agreement.
//
// Ordering parity, deterministically. Both repositories order collection items
// by (addedAt DESC, reportId DESC) and annotations by (createdAt DESC, id DESC).
// They stamp those timestamps independently: the in-memory repo from
// `new Date().toISOString()` (millisecond resolution, so two quick writes can
// TIE and then sort by the secondary key), Postgres from the column default
// `now()` (microsecond resolution across separate statements, so writes
// effectively never tie and stay in insertion order). Left to wall-clock timing
// those two orderings can legitimately diverge — and worse, the annotation
// tie-break is the RANDOM per-repo id, which never matches across drivers. To
// make the comparison total and flake-free we stamp the in-memory repo's
// item-adds and annotation-creates from a strictly-increasing synthetic clock
// (one tick per fresh write), so the in-memory order is exactly the write-recency
// order — which is also Postgres's order, and the timestamp tie never fires in
// either driver. Idempotent re-adds touch neither clock (in-memory's `has`
// short-circuit / Postgres's ON CONFLICT DO NOTHING), so an item's timestamp
// reflects its first add since the last removal in BOTH — keeping recency aligned
// across re-add/after-remove cases. Absolute timestamp values differ by
// construction, so we compare the reportId / (authorId,text) SEQUENCES (which
// encode both membership and order), never the raw timestamps or ids.

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
import type { Repository, WorkspaceRole } from '../src/infra/ports';
import type { AnalysisReport } from '../src/types';
import { gateValidReportArbitrary } from './reportGraph.arb';

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const skip = DB_URL
  ? false
  : 'no TEST_DATABASE_URL/DATABASE_URL — skipping Postgres integration test';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

// Apply every db/migrations/*.sql in lexical order (001..007), tolerating the
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

// ── Synthetic strictly-increasing clock for the in-memory repo's stamped writes ──
// FakeDate overrides only toISOString, returning a fresh increasing instant per
// fresh write. tick is module-global → monotonic across the whole run. We swap
// globalThis.Date only around the in-memory write call (whose body runs
// synchronously up to the stamp, with no intervening await), so no other code
// observes the stub — Postgres never uses JS Date for added_at/created_at, and
// the list methods' own `new Date(...)` parsing runs outside the stubbed window.
const CLOCK_BASE = Date.UTC(2020, 0, 1);
let tick = 0;
const RealDate = globalThis.Date;
class FakeDate extends RealDate {
  toISOString(): string {
    return new RealDate(CLOCK_BASE + tick++ * 1000).toISOString();
  }
}
async function withMemClock<T>(fn: () => Promise<T>): Promise<T> {
  globalThis.Date = FakeDate as DateConstructor;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

const READER_COUNT = 3;
const REPORT_POOL = 4;

// ── Generated logical operations ──
// Indices are drawn from small pools and reduced modulo the live handle count at
// interpret time, so every op references something that exists (or is skipped
// when no handle exists yet). Drawing from small pools makes the same workspace /
// collection / report frequently touched by multiple readers — the case that
// would catch a leak or an ordering divergence between drivers.
type Op =
  | { t: 'createWorkspace'; readerIdx: number; nameSeed: string }
  | { t: 'invite'; wsIdx: number; joinReaderIdx: number }
  | { t: 'removeMember'; wsIdx: number; readerIdx: number }
  | { t: 'createCollection'; wsIdx: number; nameSeed: string }
  | { t: 'deleteCollection'; colIdx: number }
  | { t: 'addItem'; colIdx: number; reportIdx: number }
  | { t: 'removeItem'; colIdx: number; reportIdx: number }
  | { t: 'createAnnotation'; wsIdx: number; reportIdx: number; authorIdx: number; textSeed: string }
  | { t: 'updateAnnotation'; annIdx: number; textSeed: string }
  | { t: 'deleteAnnotation'; annIdx: number };

const readerIdx = fc.integer({ min: 0, max: READER_COUNT - 1 });
const reportIdx = fc.integer({ min: 0, max: REPORT_POOL - 1 });
const idx = fc.nat({ max: 6 }); // reduced modulo live handle count at interpret time
const nameSeed = fc.string({ minLength: 1, maxLength: 24 });
const textSeed = fc.string({ minLength: 1, maxLength: 40 });

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ t: fc.constant('createWorkspace' as const), readerIdx, nameSeed }),
  fc.record({ t: fc.constant('invite' as const), wsIdx: idx, joinReaderIdx: readerIdx }),
  fc.record({ t: fc.constant('removeMember' as const), wsIdx: idx, readerIdx }),
  fc.record({ t: fc.constant('createCollection' as const), wsIdx: idx, nameSeed }),
  fc.record({ t: fc.constant('deleteCollection' as const), colIdx: idx }),
  fc.record({ t: fc.constant('addItem' as const), colIdx: idx, reportIdx }),
  fc.record({ t: fc.constant('removeItem' as const), colIdx: idx, reportIdx }),
  fc.record({ t: fc.constant('createAnnotation' as const), wsIdx: idx, reportIdx, authorIdx: readerIdx, textSeed }),
  fc.record({ t: fc.constant('updateAnnotation' as const), annIdx: idx, textSeed }),
  fc.record({ t: fc.constant('deleteAnnotation' as const), annIdx: idx }),
);
const opsArb = fc.array(opArb, { minLength: 1, maxLength: 30 });

// Parallel per-repo handles: index i is the SAME logical entity in both repos,
// but each repo keeps its own generated id.
interface WsHandle { memId: string; pgId: string }
interface ColHandle { memId: string; pgId: string; wsIdx: number }
interface AnnHandle { memId: string; pgId: string; wsIdx: number; reportId: string; live: boolean }

// Compare two arrays as id-agnostic multisets of a projected key.
function sortedKeys<T>(rows: T[], key: (r: T) => string): string[] {
  return rows.map(key).sort();
}

test('Property 12: in-memory and Postgres repositories agree on observable workspace results', { skip }, async () => {
  const pool = makePgPool(DB_URL as string);
  const pg = new PostgresRepository(pool);

  // One content row + a fixed pool of reports the collection/annotation ops can
  // reference (FK to analysis_reports). Built from the gate-valid arbitrary, with
  // ids/contentId pinned so both repos share the same report id pool.
  const contentId = randomUUID();
  const sampled = fc.sample(gateValidReportArbitrary, REPORT_POOL);
  const reportIds = Array.from({ length: REPORT_POOL }, () => randomUUID());
  const now = new Date().toISOString();

  try {
    await applyMigrations(pool);

    // FK parent for analysis_reports.content_id. Parameterized SQL only.
    await pool.query(
      `INSERT INTO content_items (id, url_hash, source_type, source_url, title, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [contentId, `wsparity-${contentId}`, 'youtube', 'https://youtu.be/seed', 'Seed', JSON.stringify({}), now],
    );

    // Seed the Postgres report pool ONCE through repo.saveReport so the FK that
    // collection_items / annotations have to analysis_reports(id) is satisfied.
    // The in-memory repo is fresh per run and seeded with the same pool below
    // ("Do the same on both repos for parity").
    for (let i = 0; i < REPORT_POOL; i++) {
      await pg.saveReport({ ...sampled[i]!, id: reportIds[i]!, contentId });
    }

    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        // Run-scoped reader ids so runs never collide (reader_id is TEXT, no FK).
        const runId = randomUUID();
        const readers = Array.from({ length: READER_COUNT }, (_, i) => `wsparity-${runId}-r${i}`);
        const mem: Repository = new InMemoryRepository();
        // The in-memory repo needs the same report pool present for symmetry.
        for (let i = 0; i < REPORT_POOL; i++) {
          await mem.saveReport({ ...sampled[i]!, id: reportIds[i]!, contentId });
        }

        const wsH: WsHandle[] = [];
        const colH: ColHandle[] = [];
        const annH: AnnHandle[] = [];
        const pgWorkspaceIds: string[] = []; // for exact per-run cleanup

        try {
          for (const op of ops) {
            switch (op.t) {
              case 'createWorkspace': {
                const owner = readers[op.readerIdx]!;
                const m = await mem.createWorkspace(owner, op.nameSeed);
                const p = await pg.createWorkspace(owner, op.nameSeed);
                // Returned shape agrees id-agnostically (Req 1.1, 1.2, 9.2).
                assert.equal(m.name, p.name);
                assert.equal(m.role, p.role);
                assert.equal(m.role, 'owner');
                wsH.push({ memId: m.id, pgId: p.id });
                pgWorkspaceIds.push(p.id);
                break;
              }
              case 'invite': {
                if (wsH.length === 0) break;
                const ws = wsH[op.wsIdx % wsH.length]!;
                const joiner = readers[op.joinReaderIdx]!;
                const codeM = await mem.createInvite(ws.memId);
                const codeP = await pg.createInvite(ws.pgId);
                const rM = await mem.redeemInvite(codeM, joiner);
                const rP = await pg.redeemInvite(codeP, joiner);
                // Both codes are valid → both defined; roles must agree, and an
                // existing membership keeps its role unchanged (Req 2.3, 2.5).
                assert.ok(rM && rP, 'valid invite code must redeem in both repos');
                assert.equal(rM!.role, rP!.role);
                break;
              }
              case 'removeMember': {
                if (wsH.length === 0) break;
                const ws = wsH[op.wsIdx % wsH.length]!;
                const reader = readers[op.readerIdx]!;
                await mem.removeMember(ws.memId, reader);
                await pg.removeMember(ws.pgId, reader);
                break;
              }
              case 'createCollection': {
                if (wsH.length === 0) break;
                const wi = op.wsIdx % wsH.length;
                const ws = wsH[wi]!;
                const cM = await mem.createCollection(ws.memId, op.nameSeed);
                const cP = await pg.createCollection(ws.pgId, op.nameSeed);
                assert.equal(cM.name, cP.name);
                colH.push({ memId: cM.id, pgId: cP.id, wsIdx: wi });
                break;
              }
              case 'deleteCollection': {
                if (colH.length === 0) break;
                const col = colH[op.colIdx % colH.length]!;
                const ws = wsH[col.wsIdx]!;
                await mem.deleteCollection(ws.memId, col.memId);
                await pg.deleteCollection(ws.pgId, col.pgId);
                break;
              }
              case 'addItem': {
                if (colH.length === 0) break;
                const col = colH[op.colIdx % colH.length]!;
                const reportId = reportIds[op.reportIdx]!;
                // Stamp the in-memory add from the synthetic clock so its order
                // matches Postgres's now() insertion order.
                await withMemClock(() => mem.addCollectionItem(col.memId, reportId));
                await pg.addCollectionItem(col.pgId, reportId);
                break;
              }
              case 'removeItem': {
                if (colH.length === 0) break;
                const col = colH[op.colIdx % colH.length]!;
                const reportId = reportIds[op.reportIdx]!;
                await mem.removeCollectionItem(col.memId, reportId);
                await pg.removeCollectionItem(col.pgId, reportId);
                break;
              }
              case 'createAnnotation': {
                if (wsH.length === 0) break;
                const wi = op.wsIdx % wsH.length;
                const ws = wsH[wi]!;
                const reportId = reportIds[op.reportIdx]!;
                const author = readers[op.authorIdx]!;
                const aM = await withMemClock(() =>
                  mem.createAnnotation({ workspaceId: ws.memId, reportId, authorId: author, text: op.textSeed }),
                );
                const aP = await pg.createAnnotation({ workspaceId: ws.pgId, reportId, authorId: author, text: op.textSeed });
                // Returned annotation agrees on the observable fields (Req 7.1, 9.2).
                assert.equal(aM.authorId, aP.authorId);
                assert.equal(aM.text, aP.text);
                assert.equal(aM.reportId, aP.reportId);
                annH.push({ memId: aM.id, pgId: aP.id, wsIdx: wi, reportId, live: true });
                break;
              }
              case 'updateAnnotation': {
                if (annH.length === 0) break;
                const ann = annH[op.annIdx % annH.length]!;
                await mem.updateAnnotation(ann.memId, op.textSeed);
                await pg.updateAnnotation(ann.pgId, op.textSeed);
                break;
              }
              case 'deleteAnnotation': {
                if (annH.length === 0) break;
                const ann = annH[op.annIdx % annH.length]!;
                await mem.deleteAnnotation(ann.memId);
                await pg.deleteAnnotation(ann.pgId);
                ann.live = false;
                break;
              }
            }
          }

          // ── Observable parity, id-agnostically ──

          // Each reader's workspace list: multiset of (name, role) (Req 4.1, 9.8).
          for (const reader of readers) {
            const m = await mem.listWorkspacesForReader(reader);
            const p = await pg.listWorkspacesForReader(reader);
            assert.deepEqual(
              sortedKeys(p, (w) => `${w.name}\u0000${w.role}`),
              sortedKeys(m, (w) => `${w.name}\u0000${w.role}`),
              `workspace list disagrees for reader ${reader}`,
            );
          }

          for (const ws of wsH) {
            // Workspace existence agrees (Req 8.7).
            assert.equal(await mem.workspaceExists(ws.memId), await pg.workspaceExists(ws.pgId));

            // Membership presence/absence and role agree for every reader (Req 8.2, 3.1).
            for (const reader of readers) {
              const rM = (await mem.getMembership(ws.memId, reader)) as WorkspaceRole | undefined;
              const rP = (await pg.getMembership(ws.pgId, reader)) as WorkspaceRole | undefined;
              assert.equal(rM, rP, `membership disagrees for ${reader}`);
            }

            // Member list: multiset of (readerId, role) (Req 3.1, 9.8).
            const memM = await mem.listMembers(ws.memId);
            const pgM = await pg.listMembers(ws.pgId);
            assert.deepEqual(
              sortedKeys(pgM, (x) => `${x.readerId}\u0000${x.role}`),
              sortedKeys(memM, (x) => `${x.readerId}\u0000${x.role}`),
              'member list disagrees',
            );

            // Collection list: multiset of names (Req 5.2, 9.8).
            const memC = await mem.listCollections(ws.memId);
            const pgC = await pg.listCollections(ws.pgId);
            assert.deepEqual(
              sortedKeys(pgC, (c) => c.name),
              sortedKeys(memC, (c) => c.name),
              'collection list disagrees',
            );
          }

          // Collection items: ORDERED reportId sequence (Req 6.4, 9.7).
          for (const col of colH) {
            const memItems = await mem.listCollectionItems(col.memId);
            const pgItems = await pg.listCollectionItems(col.pgId);
            assert.deepEqual(
              pgItems.map((e) => e.reportId),
              memItems.map((e) => e.reportId),
              'collection-item ordering/membership disagrees',
            );
          }

          // Annotations: ORDERED (authorId, text) sequence per (workspace, report)
          // (Req 7.2, 9.8). Dedupe the (workspace, report) pairs we read.
          const seen = new Set<string>();
          for (const ann of annH) {
            const key = `${ann.wsIdx}\u0000${ann.reportId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const ws = wsH[ann.wsIdx]!;
            const memA = await mem.listAnnotations(ws.memId, ann.reportId);
            const pgA = await pg.listAnnotations(ws.pgId, ann.reportId);
            assert.deepEqual(
              pgA.map((a) => `${a.authorId}\u0000${a.text}`),
              memA.map((a) => `${a.authorId}\u0000${a.text}`),
              'annotation ordering/membership disagrees',
            );
          }

          // Single-annotation reads: undefined-vs-present and the text agree
          // across edit/delete (Req 7.3, 7.4, 7.5).
          for (const ann of annH) {
            const gM = await mem.getAnnotation(ann.memId);
            const gP = await pg.getAnnotation(ann.pgId);
            assert.equal(gM === undefined, gP === undefined, 'annotation presence disagrees');
            if (gM && gP) {
              assert.equal(gM.authorId, gP.authorId);
              assert.equal(gM.text, gP.text);
              assert.equal(gM.reportId, gP.reportId);
            }
          }
        } finally {
          // Drop this run's workspaces (cascade removes members, invites,
          // collections, items, annotations). Run-unique ids → exact scope.
          if (pgWorkspaceIds.length > 0) {
            await pool.query(`DELETE FROM workspaces WHERE id = ANY($1)`, [pgWorkspaceIds]).catch(() => {});
          }
        }
      }),
      { numRuns: 100 },
    );
  } finally {
    // content_items delete cascades to analysis_reports → collection_items /
    // annotations / reader_saved_reports.
    await pool.query('DELETE FROM content_items WHERE id = $1', [contentId]).catch(() => {});
    await pool.end();
  }
});
