// Feature: report-graph-normalization, Property 4: Non-normalized fields are retained in JSONB and omitted from rows
// Validates: Requirements 3.5
//
// For any gate-valid report carrying fields with no normalized column
// (Claim.evidenceDescription, PerspectiveLink.whyIncluded), after saveReport
// those fields still appear in the retrievable JSONB payload (getReport returns
// a report whose claims still carry evidenceDescription and whose perspectives
// still carry whyIncluded — wherever the source had them) AND never appear on
// any projected normalized row (no ClaimRow carries an evidenceDescription
// property, no PerspectiveRow carries a whyIncluded property). Run against a
// fresh InMemoryRepository, which exercises the same projectReportGraph
// dual-write path as Postgres (offline-first parity).

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { gateValidReportArbitrary } from './reportGraph.arb';

test('non-normalized fields are retained in JSONB and omitted from rows', async () => {
  await fc.assert(
    fc.asyncProperty(gateValidReportArbitrary, async (report) => {
      const repo = new InMemoryRepository();
      await repo.saveReport(report);

      // 1. The JSONB payload still carries the non-normalized fields wherever
      //    the source report had them (Req 3.5 — retained in JSONB).
      const served = await repo.getReport(report.id);
      assert.ok(served !== undefined, 'report retrievable from JSONB');

      report.claims.forEach((claim, i) => {
        const servedClaim = served.claims[i];
        assert.ok(servedClaim !== undefined);
        // evidenceDescription presence and value round-trip exactly.
        assert.equal(
          Object.prototype.hasOwnProperty.call(servedClaim, 'evidenceDescription'),
          Object.prototype.hasOwnProperty.call(claim, 'evidenceDescription'),
        );
        assert.equal(servedClaim.evidenceDescription, claim.evidenceDescription);
      });

      report.perspectives.forEach((perspective, i) => {
        const servedPerspective = served.perspectives[i];
        assert.ok(servedPerspective !== undefined);
        // whyIncluded presence and value round-trip exactly.
        assert.equal(
          Object.prototype.hasOwnProperty.call(servedPerspective, 'whyIncluded'),
          Object.prototype.hasOwnProperty.call(perspective, 'whyIncluded'),
        );
        assert.equal(servedPerspective.whyIncluded, perspective.whyIncluded);
      });

      // 2. The non-normalized fields never appear on any projected row, even
      //    when the source claim/perspective carried them (Req 3.5 — omitted
      //    only that field from the projection).
      const claimRows = repo.claimRows.get(report.id) ?? [];
      for (const row of claimRows) {
        assert.ok(
          !Object.prototype.hasOwnProperty.call(row, 'evidenceDescription'),
          'no ClaimRow carries evidenceDescription',
        );
      }

      const perspectiveRows = repo.perspectiveRows.get(report.id) ?? [];
      for (const row of perspectiveRows) {
        assert.ok(
          !Object.prototype.hasOwnProperty.call(row, 'whyIncluded'),
          'no PerspectiveRow carries whyIncluded',
        );
      }
    }),
    { numRuns: 200 },
  );
});
