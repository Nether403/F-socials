// Feature: accounts-save-history, Property 6: Saved report content is immutable across save/history operations
// Validates: Requirements 13.3
//
// For any persisted report, saving it, removing it from a reader's set, or
// listing it in history leaves the report's stored content — claims, citations,
// framing signals, and readiness state — byte-for-byte unchanged from its value
// before the operation. Approach: persist a report via repo.saveReport, snapshot
// its serialized content from getReport, run save/remove/list saved-report
// operations (the only Saved_Report access path), then re-fetch and assert the
// serialization is byte-for-byte identical. The Saved_Report store keys only the
// (reader, report) association — it never owns or mutates report content.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { gateValidReportArbitrary } from './reportGraph.arb';

// Reader identity is the Supabase JWT subject (an opaque non-empty string).
const readerArb = fc.string({ minLength: 1, maxLength: 32 }).map((s) => `r${s}`);

test('Property 6: saved/remove/list operations never mutate stored report content', async () => {
  await fc.assert(
    fc.asyncProperty(
      gateValidReportArbitrary,
      fc.array(readerArb, { minLength: 1, maxLength: 4 }),
      async (report, readers) => {
        const repo = new InMemoryRepository();
        await repo.saveReport(report);

        // Byte-for-byte snapshot of the stored content before any save/history op.
        const before = JSON.stringify(await repo.getReport(report.id));

        // Exercise the full Saved_Report surface for every reader: save (twice,
        // to cover the idempotent path), list, then remove (twice, to cover the
        // absent no-op path), then list again.
        for (const reader of readers) {
          await repo.saveSavedReport(reader, report.id);
          await repo.saveSavedReport(reader, report.id);
          await repo.listSavedReports(reader);
          await repo.removeSavedReport(reader, report.id);
          await repo.removeSavedReport(reader, report.id);
          await repo.listSavedReports(reader);
        }

        // The stored report content — claims, citations, framing signals, and
        // readiness state — is unchanged after all save/history operations.
        const after = JSON.stringify(await repo.getReport(report.id));
        assert.equal(after, before, 'report content changed after save/history operations');
      },
    ),
    { numRuns: 100 },
  );
});
