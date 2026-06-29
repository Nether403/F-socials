// Feature: accounts-save-history, Property 1: Save is idempotent and visible in history
// Validates: Requirements 7.3, 9.8, 11.6, 11.7
//
// For any reader and report identifier, and for any number of repeated saves
// (interleaved with saves by OTHER readers), the repository holds EXACTLY ONE
// Saved_Report for that (reader, report) pair, and that report appears in the
// reader's history.
//   - Idempotency: repeated saves of the same (reader, report) never create a
//     duplicate — the reader's history contains the report exactly once (Req 7.3,
//     11.6).
//   - Visibility: after saving, the report is present in the reader's history
//     (Req 9.8).
//   - Non-interference: interleaved saves by other readers (a different reader
//     namespace) never affect the target reader's count.
// Runs against the in-memory Repository with no API keys / no database, the
// offline-first path (Req 11.7).

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';

// Target reader/report live in the `R-`/`P-` namespaces; interleaved other-reader
// saves live in the `O-` namespace, so an "other" save can never collide with the
// target reader (its report id may freely overlap — that only exercises scoping).
const targetReaderArb = fc.string({ minLength: 1, maxLength: 16 }).map((s) => `R-${s}`);
const targetReportArb = fc.string({ minLength: 1, maxLength: 16 }).map((s) => `P-${s}`);

const opArb = fc.oneof(
  // A repeat save of the target (reader, report) pair.
  fc.record({ kind: fc.constant('target' as const) }),
  // A save by some other reader of some report.
  fc.record({
    kind: fc.constant('other' as const),
    reader: fc.string({ minLength: 1, maxLength: 16 }).map((s) => `O-${s}`),
    report: fc.string({ minLength: 1, maxLength: 16 }),
  }),
);

test('Property 1: save is idempotent and the report is visible in the reader history', async () => {
  await fc.assert(
    fc.asyncProperty(
      targetReaderArb,
      targetReportArb,
      fc.array(opArb, { minLength: 0, maxLength: 20 }),
      async (reader, report, ops) => {
        const repo = new InMemoryRepository();

        let targetSaves = 0;
        for (const op of ops) {
          if (op.kind === 'target') {
            await repo.saveSavedReport(reader, report);
            targetSaves++;
          } else {
            await repo.saveSavedReport(op.reader, op.report);
          }
        }
        // "Any number of repeated saves" includes one: guarantee at least one
        // save of the target pair so the visibility claim is well-defined.
        if (targetSaves === 0) await repo.saveSavedReport(reader, report);

        const history = await repo.listSavedReports(reader);
        const matches = history.filter((e) => e.reportId === report);

        // Exactly one Saved_Report for the (reader, report) pair — no duplicate,
        // regardless of how many times it was saved (Req 7.3, 11.6).
        assert.equal(
          matches.length,
          1,
          `expected exactly one Saved_Report for the (reader, report) pair, got ${matches.length}`,
        );
        // The saved report is visible in the reader's history (Req 9.8).
        assert.ok(
          history.some((e) => e.reportId === report),
          'saved report must appear in the reader history',
        );
      },
    ),
    { numRuns: 100 },
  );
});
