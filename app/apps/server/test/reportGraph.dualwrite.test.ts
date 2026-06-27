// Feature: report-graph-normalization, Property 1: Dual-write populates normalized rows and keeps the JSONB retrievable
// Validates: Requirements 1.1, 1.5, 4.2, 6.3
//
// For any gate-valid report (which always carries >=1 claim), after saveReport
// the report is still retrievable as its JSONB payload (getReport returns the
// same object) AND its normalized rows — claimRows, citationRows,
// perspectiveRows keyed by report.id — are present in the repository. Run
// against a fresh InMemoryRepository, which exercises the same
// projectReportGraph dual-write path as Postgres (offline-first parity, 6.3).

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { projectReportGraph } from '../src/core/reportGraph';
import { gateValidReportArbitrary } from './reportGraph.arb';

test('dual-write populates normalized rows and keeps the JSONB retrievable', async () => {
  await fc.assert(
    fc.asyncProperty(gateValidReportArbitrary, async (report) => {
      // gateValidReportArbitrary guarantees >=1 claim by construction.
      assert.ok(report.claims.length >= 1);

      const repo = new InMemoryRepository();
      await repo.saveReport(report);

      // JSONB payload stays the authoritative render source of truth: getReport
      // returns the same report object that was persisted (Req 1.1, 4.2).
      const served = await repo.getReport(report.id);
      assert.deepEqual(served, report);

      // Normalized rows for this report are present — at least one Dual_Write
      // populated the claims/citations/perspectives rows keyed by report.id
      // (Req 1.5, 6.3).
      const claimRows = repo.claimRows.get(report.id);
      const citationRows = repo.citationRows.get(report.id);
      const perspectiveRows = repo.perspectiveRows.get(report.id);

      assert.ok(claimRows !== undefined, 'claim rows present');
      assert.ok(citationRows !== undefined, 'citation rows present');
      assert.ok(perspectiveRows !== undefined, 'perspective rows present');

      // A report with >=1 claim has >=1 claim row, and hasReportGraph reports it.
      assert.ok(claimRows.length >= 1, 'at least one claim row');
      assert.equal(await repo.hasReportGraph(report.id), true);

      // The persisted rows match the pure projection of the same object — the
      // normalized write derives from the same report that wrote the JSONB.
      const graph = projectReportGraph(report);
      assert.deepEqual(claimRows, graph.claims);
      assert.deepEqual(citationRows, graph.citations);
      assert.deepEqual(perspectiveRows, graph.perspectives);
    }),
    { numRuns: 200 },
  );
});
