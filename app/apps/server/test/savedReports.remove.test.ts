// Feature: accounts-save-history, Property 2: Remove is idempotent and non-interfering
// Validates: Requirements 8.3, 10.7, 11.10
//
// For any reader's saved set and any report id, removing that report leaves the
// (reader, report) pair absent and every OTHER Saved_Report — the reader's own
// AND every other reader's — unchanged; removing a report that is not in the set
// succeeds (no throw, no-op) and changes nothing (Req 8.3, 10.7, 11.10).
//
// The InMemoryRepository is the only persistence path and is atomic by
// construction (no `await` between read and write in removeSavedReport). We seed
// arbitrary saved state across multiple readers, snapshot it, remove an
// arbitrary (reader, report) — sometimes one that is present, sometimes one that
// is absent — and assert the target pair is gone while every other pair, for
// every reader, is byte-for-byte preserved.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import type { SavedReportEntry } from '../src/infra/ports';

// A small pool of reader/report ids so collisions (shared reports across
// readers, repeated saves) actually happen, exercising the non-interference and
// idempotency paths rather than always operating on disjoint singletons.
const readerArb = fc.constantFrom('r1', 'r2', 'r3');
const reportArb = fc.constantFrom('a', 'b', 'c', 'd');

// A seed of (reader, report) saves to apply, building arbitrary multi-reader state.
const savesArb = fc.array(fc.record({ reader: readerArb, report: reportArb }), { maxLength: 20 });

// Snapshot every reader's set as a plain comparable map: reader -> sorted report ids.
async function snapshot(repo: InMemoryRepository, readers: readonly string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const r of readers) {
    const entries: SavedReportEntry[] = await repo.listSavedReports(r);
    out[r] = entries.map((e) => e.reportId).sort();
  }
  return out;
}

test('Property 2: remove is idempotent and non-interfering', async () => {
  const readers = ['r1', 'r2', 'r3'] as const;

  await fc.assert(
    fc.asyncProperty(savesArb, readerArb, reportArb, async (saves, targetReader, targetReport) => {
      const repo = new InMemoryRepository();
      for (const { reader, report } of saves) {
        await repo.saveSavedReport(reader, report);
      }

      const before = await snapshot(repo, readers);

      await repo.removeSavedReport(targetReader, targetReport);

      const after = await snapshot(repo, readers);

      // The target pair is absent after removal — whether it was present or not.
      assert.ok(
        !after[targetReader]!.includes(targetReport),
        `target pair (${targetReader}, ${targetReport}) should be absent after remove`,
      );

      // Every OTHER pair is unchanged: for the target reader, the set equals the
      // prior set minus the target report; for every other reader, identical.
      for (const r of readers) {
        if (r === targetReader) {
          const expected = before[r]!.filter((id) => id !== targetReport);
          assert.deepEqual(after[r], expected, `target reader ${r} should differ only by the removed report`);
        } else {
          assert.deepEqual(after[r], before[r], `non-target reader ${r} must be untouched`);
        }
      }

      // Idempotent: a second remove of the same pair is also a no-op success.
      await repo.removeSavedReport(targetReader, targetReport);
      const afterSecond = await snapshot(repo, readers);
      assert.deepEqual(afterSecond, after, 'a repeated remove changes nothing');
    }),
    { numRuns: 100 },
  );
});
