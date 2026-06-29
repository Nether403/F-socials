// Feature: accounts-save-history, Property 3: History is reader-scoped
// Validates: Requirements 9.6, 10.5, 10.8, 11.8
//
// For any state produced by saves across multiple readers, listing a reader's
// history returns exactly that reader's current saves and excludes every other
// reader's report; a reader with no saves gets an empty list.
//
// We generate save operations drawn from a small shared pool of reader ids and
// report ids so the SAME report id is frequently saved by more than one reader —
// the case that would catch a leak between readers. A model Map<reader, Set<report>>
// records what each reader saved; listSavedReports(reader) must return exactly
// that reader's set (membership), never a report saved only by someone else, and
// a reader who saved nothing (including a fresh, never-seen id) must get [].

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

// One generated scenario: a pool of distinct readers, a pool of distinct report
// ids (small, so they overlap across readers and force real scoping), a sequence
// of (reader, report) saves drawn from those pools, and a fresh reader that never
// saves anything.
const scenarioArb = fc
  .record({
    readers: fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 5 }),
    reports: fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 6 }),
    untouchedReader: fc.uuid(),
  })
  .chain(({ readers, reports, untouchedReader }) =>
    fc.record({
      readers: fc.constant(readers),
      reports: fc.constant(reports),
      untouchedReader: fc.constant(untouchedReader),
      ops: fc.array(
        fc.record({
          reader: fc.constantFrom(...readers),
          report: fc.constantFrom(...reports),
        }),
        { maxLength: 40 },
      ),
    }),
  );

test('Property 3: history is reader-scoped — each reader sees exactly its own saves', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async ({ readers, ops, untouchedReader }) => {
      const repo = new InMemoryRepository();
      // Model: what each reader has saved.
      const model = new Map<string, Set<string>>();

      for (const { reader, report } of ops) {
        await repo.saveSavedReport(reader, report);
        let set = model.get(reader);
        if (!set) {
          set = new Set<string>();
          model.set(reader, set);
        }
        set.add(report);
      }

      // Every reader in the pool sees exactly its own saved set, in any order.
      for (const reader of readers) {
        const expected = model.get(reader) ?? new Set<string>();
        const listed = await repo.listSavedReports(reader);
        const listedIds = listed.map((e) => e.reportId);

        // No duplicates leaked in (at most one entry per (reader, report)).
        assert.equal(
          listedIds.length,
          new Set(listedIds).size,
          'reader history contains a duplicate report id',
        );
        // Membership equals the reader's own set (Req 9.6, 11.8).
        assert.deepEqual(
          new Set(listedIds),
          expected,
          'reader history does not equal its own saved set',
        );
        // Explicit exclusion: nothing saved ONLY by another reader appears.
        for (const id of listedIds) {
          assert.ok(expected.has(id), `reader history leaked another reader's report ${id}`);
        }
      }

      // A reader with no saves gets an empty list (Req 10.8) — both a pool reader
      // who happened to save nothing and a fresh, never-seen id.
      const emptyReaders = [untouchedReader, ...readers.filter((r) => !model.has(r))];
      for (const reader of emptyReaders) {
        assert.deepEqual(await repo.listSavedReports(reader), []);
      }
    }),
    { numRuns: 100 },
  );
});
