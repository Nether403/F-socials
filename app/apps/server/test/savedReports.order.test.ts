// Feature: accounts-save-history, Property 4: History ordering is deterministic and stable
// Validates: Requirements 9.2
//
// For any set of saved entries, the reader's history list is ordered
// most-recently-saved first (savedAt DESC), breaking ties by report identifier
// (reportId DESC), and repeated calls on the same state return an identical
// (byte-for-byte) order.
//
// The InMemoryRepository stamps savedAt from `new Date().toISOString()`, so to
// exercise the tie-break by reportId DESC deterministically we must control
// timing: each save's timestamp is drawn from a small fixed pool, guaranteeing
// equal-savedAt collisions across distinct reports. Date is stubbed only around
// the save loop (restored in a finally) so each new save consumes the next
// queued timestamp; reportIds are unique so every save is a fresh entry that
// consumes exactly one timestamp.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import type { SavedReportEntry } from '../src/infra/ports';

// A small pool of DISTINCT ISO-8601 timestamps. Drawing many distinct reportIds
// from this small pool forces equal-savedAt groups, which is what makes the
// reportId-DESC tie-break observable rather than incidental.
const TIMESTAMP_POOL = [
  '2021-01-01T00:00:00.000Z',
  '2022-06-15T12:30:00.000Z',
  '2023-03-20T08:00:00.000Z',
  '2024-11-30T23:59:59.999Z',
];

// Entries with unique reportIds (so every save is a new entry) and a savedAt
// picked from the pool (so collisions are guaranteed once there are more
// reports than pool slots).
const entriesArb = fc.uniqueArray(
  fc.record({
    reportId: fc.uuid(),
    savedAt: fc.constantFrom(...TIMESTAMP_POOL),
  }),
  { minLength: 1, maxLength: 12, selector: (e) => e.reportId },
);

// The reference comparator: savedAt DESC, then reportId DESC. This is the
// independent oracle the repository's output must match.
function expectedOrder(entries: { reportId: string; savedAt: string }[]): SavedReportEntry[] {
  return [...entries]
    .map((e) => ({ reportId: e.reportId, savedAt: e.savedAt }))
    .sort((a, b) =>
      a.savedAt < b.savedAt ? 1
      : a.savedAt > b.savedAt ? -1
      : a.reportId < b.reportId ? 1
      : a.reportId > b.reportId ? -1
      : 0,
    );
}

test('Property 4: history ordering is deterministic (savedAt DESC, reportId DESC) and stable', async () => {
  await fc.assert(
    fc.asyncProperty(entriesArb, fc.uuid(), async (entries, reader) => {
      const repo = new InMemoryRepository();

      // Drive savedAt deterministically: each new save pops the next queued
      // timestamp. saveSavedReport only stamps on a fresh entry, and reportIds
      // are unique, so the queue advances exactly once per save.
      const RealDate = globalThis.Date;
      const queue = entries.map((e) => e.savedAt);
      let i = 0;
      class FakeDate extends RealDate {
        toISOString(): string {
          return queue[i++]!;
        }
      }
      globalThis.Date = FakeDate as DateConstructor;
      try {
        for (const e of entries) {
          await repo.saveSavedReport(reader, e.reportId);
        }
      } finally {
        globalThis.Date = RealDate;
      }

      const list1 = await repo.listSavedReports(reader);
      const list2 = await repo.listSavedReports(reader);

      // 1) Matches the independent oracle: savedAt DESC, then reportId DESC.
      assert.deepStrictEqual(list1, expectedOrder(entries));

      // 2) Tie-break is actually exercised: within any equal-savedAt run the
      //    reportIds are strictly descending (reportIds are unique).
      for (let k = 0; k + 1 < list1.length; k++) {
        const cur = list1[k]!;
        const next = list1[k + 1]!;
        // Global order is non-increasing on savedAt.
        assert.ok(cur.savedAt >= next.savedAt, 'savedAt must be non-increasing');
        if (cur.savedAt === next.savedAt) {
          assert.ok(cur.reportId > next.reportId, 'equal-savedAt ties break by reportId DESC');
        }
      }

      // 3) Repeated calls on identical state are byte-for-byte equal.
      assert.equal(JSON.stringify(list1), JSON.stringify(list2));
    }),
    { numRuns: 100 },
  );
});
