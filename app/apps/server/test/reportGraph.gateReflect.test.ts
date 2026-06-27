// Feature: report-graph-normalization, Property 8: Faithful reflection of the gate-satisfying state without re-deriving the gate
// Validates: Requirements 10.2
//
// For any gate-valid report, the projection reflects the report's evidence
// structure exactly as the invariant gate produced it — every claim with
// evidenceStrength other than 'none' has at least one linked citation row
// (mirroring the source's >=1 citations), and every claim with 'none' AND zero
// citations is projected as a valid claim row with zero linked citation rows —
// WITHOUT the projection computing, asserting, or altering the report's
// readiness status. The rows mirror whatever the gate already produced; the
// projection reads straight off the claim and never re-derives the gate.
//
// The structural half of the property: projectReportGraph returns only
// { claims, citations, perspectives } with no readiness/status field, and no
// row object carries a status/reasons field — there is nowhere for a re-derived
// gate verdict to live.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { projectReportGraph } from '../src/core/reportGraph';
import { gateValidReportArbitrary } from './reportGraph.arb';

test('Property 8: faithful reflection of the gate-satisfying evidence structure', async () => {
  await fc.assert(
    fc.asyncProperty(gateValidReportArbitrary, async (report) => {
      const repo = new InMemoryRepository();
      await repo.saveReport(report);

      const claimRows = repo.claimRows.get(report.id) ?? [];
      const citationRows = repo.citationRows.get(report.id) ?? [];

      for (const claim of report.claims) {
        const claimRow = claimRows.find((cr) => cr.claimUid === claim.id);
        // The claim is projected as a valid claim row regardless of strength.
        assert.ok(claimRow, `claim ${claim.id} should have a projected claim row`);

        const linked = citationRows.filter((cit) => cit.claimUid === claim.id);

        if (claim.evidenceStrength === 'none' && claim.citations.length === 0) {
          // Honest none/zero-citation claim stays a valid claim row with zero
          // linked citation rows — the projection never invents evidence.
          assert.equal(linked.length, 0);
        } else {
          // Any claim with evidenceStrength other than 'none' is gate-guaranteed
          // to carry >=1 citation; the projection mirrors that with >=1 linked row.
          assert.notEqual(claim.evidenceStrength, 'none');
          assert.ok(
            linked.length >= 1,
            `non-'none' claim ${claim.id} should have >=1 linked citation row`,
          );
        }
      }

      // The projection does not re-derive or emit the gate: its shape is exactly
      // { claims, citations, perspectives } — no readiness/status field anywhere.
      const graph = projectReportGraph(report);
      assert.deepEqual(
        Object.keys(graph).sort(),
        ['citations', 'claims', 'perspectives'],
      );

      // No projected row object carries a status/reasons field; rows mirror the
      // claim's evidence shape, not any computed readiness verdict.
      for (const row of [...graph.claims, ...graph.citations, ...graph.perspectives]) {
        const keys = Object.keys(row);
        assert.ok(!keys.includes('status'), `row carries a status field: ${keys.join(',')}`);
        assert.ok(!keys.includes('reasons'), `row carries a reasons field: ${keys.join(',')}`);
        assert.ok(!keys.includes('readiness'), `row carries a readiness field: ${keys.join(',')}`);
      }
    }),
    { numRuns: 100 },
  );
});
