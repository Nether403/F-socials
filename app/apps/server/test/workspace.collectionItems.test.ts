// Feature: institutional-workspace, Property 6: Collection-item add/remove is idempotent and non-interfering
// Validates: Requirements 6.1, 6.2, 6.5, 6.6, 9.7
//
// Over an arbitrary interleaved sequence of add/remove operations on (collection,
// report) pairs across multiple collections, the in-memory Repository behaves like
// a per-collection set with a stable insertion timestamp:
//
//   - Final set: a report is a Collection_Item of a collection iff its last op on
//     that (collection, report) pair was an add. Exactly one item per pair — repeat
//     adds never duplicate (Req 6.1, 6.2, 9.7).
//   - addedAt stability: re-adding an already-present item keeps the ORIGINAL
//     addedAt unchanged (Req 6.2). It only changes after the item has been removed
//     and added afresh.
//   - Remove of an absent item is a no-op success that leaves every other item
//     unchanged (Req 6.5, 6.6).
//   - Non-interference: operations on one collection never change another
//     collection's items — each collection's final set matches its own model.
//
// We drive a SMALL shared pool of collections and report ids so the same pair is
// added/removed repeatedly and adjacent collections overlap on report ids — the
// interleaving that would expose a duplicate, a lost item, or a cross-collection
// leak. A model (per-collection presence Map + recorded addedAt) records the
// intended state; the repository reads must match it exactly.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

// A scenario: a fixed pool of collections and report ids, plus an interleaved
// op sequence. Picks are nat indices resolved (mod) against the pools, so every
// op targets a real (collection, report) pair and overlaps are frequent.
const scenarioArb = fc
  .record({
    collectionCount: fc.integer({ min: 1, max: 4 }),
    reports: fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 5 }),
    ops: fc.array(
      fc.record({
        kind: fc.constantFrom('add' as const, 'remove' as const),
        colPick: fc.nat(),
        reportPick: fc.nat(),
      }),
      { maxLength: 60 },
    ),
  });

test('Property 6: collection-item add/remove is idempotent and non-interfering', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async ({ collectionCount, reports, ops }) => {
      const repo = new InMemoryRepository();

      // Create the collection pool up front (one workspace; collection scoping is
      // not under test here, the per-collection item map is).
      const ws = await repo.createWorkspace('owner', 'ws');
      const colIds: string[] = [];
      for (let i = 0; i < collectionCount; i++) {
        const col = await repo.createCollection(ws.id, `col-${i}`);
        colIds.push(col.id);
      }

      // Model: per-collection presence (Set of present reportIds) and the addedAt
      // we observed when each currently-present item was (re)added afresh.
      const present = new Map<string, Set<string>>();
      const recordedAddedAt = new Map<string, Map<string, string>>();
      for (const cid of colIds) {
        present.set(cid, new Set());
        recordedAddedAt.set(cid, new Map());
      }

      // Lookup helper: the addedAt the repository currently reports for a pair,
      // or undefined when the item is absent.
      const repoAddedAt = async (collectionId: string, reportId: string): Promise<string | undefined> => {
        const items = await repo.listCollectionItems(collectionId);
        const entry = items.find((e) => e.reportId === reportId);
        return entry?.addedAt;
      };

      for (const op of ops) {
        const cid = colIds[op.colPick % colIds.length];
        const reportId = reports[op.reportPick % reports.length];
        // noUncheckedIndexedAccess: both pools are non-empty, so the mod index is
        // always in range, but guard explicitly to keep the file strict-safe.
        if (cid === undefined || reportId === undefined) continue;
        const presentSet = present.get(cid);
        const addedAtMap = recordedAddedAt.get(cid);
        if (presentSet === undefined || addedAtMap === undefined) continue;

        if (op.kind === 'add') {
          const wasPresent = presentSet.has(reportId);
          await repo.addCollectionItem(cid, reportId);
          const after = await repoAddedAt(cid, reportId);
          assert.ok(after !== undefined, 'item must be present immediately after an add');

          if (wasPresent) {
            // Re-adding an already-present item keeps the ORIGINAL addedAt (Req 6.2).
            const original = addedAtMap.get(reportId);
            assert.equal(after, original, 're-add must not change the original addedAt');
          } else {
            // Fresh add (first time, or after a prior removal): record the new addedAt.
            addedAtMap.set(reportId, after);
            presentSet.add(reportId);
          }
        } else {
          // remove — a no-op success when the item is absent (Req 6.5, 6.6).
          await repo.removeCollectionItem(cid, reportId);
          presentSet.delete(reportId);
          addedAtMap.delete(reportId);
        }
      }

      // Final state: every collection's item set equals its model set, exactly one
      // item per (collection, report) pair, and no cross-collection interference
      // (each collection is asserted independently against its own model).
      for (const cid of colIds) {
        const items = await repo.listCollectionItems(cid);
        const ids = items.map((e) => e.reportId);
        const expected = present.get(cid);
        assert.ok(expected !== undefined);

        // No duplicates: exactly one Collection_Item per report (Req 6.2, 9.7).
        assert.equal(ids.length, new Set(ids).size, `collection ${cid} has a duplicate item`);
        // Final set equals the model — a report is present iff its last op was an
        // add; removed/absent reports are gone; others untouched (Req 6.1, 6.6).
        assert.deepEqual(new Set(ids), expected, `collection ${cid} item set != model`);
      }
    }),
    { numRuns: 100 },
  );
});
