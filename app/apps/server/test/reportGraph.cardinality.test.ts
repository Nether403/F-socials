// Feature: report-graph-normalization, Property 2: Exact cardinality and claim–citation linkage
// Validates: Requirements 2.1, 2.2, 2.3, 2.7, 2.8
//
// For any gate-valid report, the dual-write (InMemoryRepository.saveReport, which
// runs the same projectReportGraph projection as Postgres) produces exactly one
// claim row per Claim, exactly one citation row per Citation across all claims
// (each linked by claimUid to a present claim row), and exactly one perspective
// row per PerspectiveLink. A claim with evidenceStrength 'none' and zero citations
// yields its claim row with zero linked citation rows.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { gateValidReportArbitrary } from './reportGraph.arb';

test('Property 2: exact cardinality and claim–citation linkage', async () => {
  await fc.assert(
    fc.asyncProperty(gateValidReportArbitrary, async (report) => {
      const repo = new InMemoryRepository();
      await repo.saveReport(report);

      const claimRows = repo.claimRows.get(report.id) ?? [];
      const citationRows = repo.citationRows.get(report.id) ?? [];
      const perspectiveRows = repo.perspectiveRows.get(report.id) ?? [];

      // Req 2.1 — exactly one claim row per Claim.
      assert.equal(claimRows.length, report.claims.length);

      // Req 2.2 — exactly one citation row per Citation across all claims.
      const expectedCitations = report.claims.reduce(
        (sum, c) => sum + c.citations.length,
        0,
      );
      assert.equal(citationRows.length, expectedCitations);

      // Req 2.3 — exactly one perspective row per PerspectiveLink.
      assert.equal(perspectiveRows.length, report.perspectives.length);

      // Req 2.2 (linkage) — every citation row links by claimUid to a present claim row.
      const claimUids = new Set(claimRows.map((cr) => cr.claimUid));
      for (const cit of citationRows) {
        assert.ok(
          claimUids.has(cit.claimUid),
          `citation claimUid ${cit.claimUid} has no matching claim row`,
        );
      }

      // Per-claim cardinality: each claim contributes exactly its own citation count,
      // matched by claimUid back to the originating Claim.
      for (const claim of report.claims) {
        const linked = citationRows.filter((cit) => cit.claimUid === claim.id);
        if (claim.evidenceStrength === 'none' && claim.citations.length === 0) {
          // Req 2.7 — honest none/zero-citation claim contributes zero citation rows.
          assert.equal(linked.length, 0);
        } else {
          // Req 2.8 — any other claim contributes one citation row per citation.
          assert.equal(linked.length, claim.citations.length);
        }
      }
    }),
    { numRuns: 100 },
  );
});
