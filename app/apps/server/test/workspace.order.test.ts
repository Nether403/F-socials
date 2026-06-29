// Feature: institutional-workspace, Property 7: Collection-item ordering is deterministic and stable
// Validates: Requirements 6.4
//
// For any set of reports added to a Shared_Collection, listCollectionItems
// returns them ordered most-recently-added first (addedAt DESC), breaking ties
// by report identifier (reportId DESC), and repeated calls on the same state
// return an identical (byte-for-byte) order — stable across reloads.
//
// The InMemoryRepository stamps addedAt from `new Date().toISOString()`, so to
// exercise the tie-break by reportId DESC deterministically we must control
// timing: each add's timestamp is drawn from a small fixed pool, guaranteeing
// equal-addedAt collisions across distinct reports. Date is stubbed only around
// the add loop (restored in a finally) so each new add consumes the next queued
// timestamp; reportIds are unique so every add is a fresh item that consumes
// exactly one timestamp. (Same technique as savedReports.order.test.ts.)

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import type { CollectionItemEntry } from '../src/infra/ports';

// A small pool of DISTINCT ISO-8601 timestamps. Drawing many distinct reportIds
// from this small pool forces equal-addedAt groups, which is what makes the
// reportId-DESC tie-break observable rather than incidental.
const TIMESTAMP_POOL = [
  '2021-01-01T00:00:00.000Z',
  '2022-06-15T12:30:00.000Z',
  '2023-03-20T08:00:00.000Z',
  '2024-11-30T23:59:59.999Z',
];

// Items with unique reportIds (so every add is a new item) and an addedAt picked
// from the pool (so collisions are guaranteed once there are more reports than
// pool slots).
const itemsArb = fc.uniqueArray(
  fc.record({
    reportId: fc.uuid(),
    addedAt: fc.constantFrom(...TIMESTAMP_POOL),
  }),
  { minLength: 1, maxLength: 12, selector: (e) => e.reportId },
);

// The reference comparator: addedAt DESC, then reportId DESC. This is the
// independent oracle the repository's output must match.
function expectedOrder(items: { reportId: string; addedAt: string }[]): CollectionItemEntry[] {
  return [...items]
    .map((e) => ({ reportId: e.reportId, addedAt: e.addedAt }))
    .sort((a, b) =>
      a.addedAt < b.addedAt ? 1
      : a.addedAt > b.addedAt ? -1
      : a.reportId < b.reportId ? 1
      : a.reportId > b.reportId ? -1
      : 0,
    );
}

test('Property 7: collection-item ordering is deterministic (addedAt DESC, reportId DESC) and stable', async () => {
  await fc.assert(
    fc.asyncProperty(itemsArb, fc.uuid(), fc.string({ minLength: 1, maxLength: 100 }), async (items, owner, name) => {
      const repo = new InMemoryRepository();
      const ws = await repo.createWorkspace(owner, name);
      const collection = await repo.createCollection(ws.id, name);

      // Drive addedAt deterministically: each new add pops the next queued
      // timestamp. addCollectionItem only stamps on a fresh item, and reportIds
      // are unique, so the queue advances exactly once per add.
      const RealDate = globalThis.Date;
      const queue = items.map((e) => e.addedAt);
      let i = 0;
      class FakeDate extends RealDate {
        toISOString(): string {
          return queue[i++]!;
        }
      }
      globalThis.Date = FakeDate as DateConstructor;
      try {
        for (const e of items) {
          await repo.addCollectionItem(collection.id, e.reportId);
        }
      } finally {
        globalThis.Date = RealDate;
      }

      const list1 = await repo.listCollectionItems(collection.id);
      const list2 = await repo.listCollectionItems(collection.id);

      // 1) Matches the independent oracle: addedAt DESC, then reportId DESC.
      assert.deepStrictEqual(list1, expectedOrder(items));

      // 2) Ordering invariant holds for every adjacent pair: addedAt is
      //    non-increasing, and within any equal-addedAt run the reportIds are
      //    strictly descending (reportIds are unique).
      for (let k = 0; k + 1 < list1.length; k++) {
        const cur = list1[k]!;
        const next = list1[k + 1]!;
        assert.ok(cur.addedAt >= next.addedAt, 'addedAt must be non-increasing');
        if (cur.addedAt === next.addedAt) {
          assert.ok(cur.reportId > next.reportId, 'equal-addedAt ties break by reportId DESC');
        }
      }

      // 3) Repeated calls on identical state are byte-for-byte equal (stable
      //    across reloads).
      assert.equal(JSON.stringify(list1), JSON.stringify(list2));
    }),
    { numRuns: 100 },
  );
});
