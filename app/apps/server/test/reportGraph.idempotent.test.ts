// Feature: report-graph-normalization, Property 5: Idempotent replace
// Validates: Requirements 5.1, 5.2, 5.3
//
// For any gate-valid report, the dual-write (InMemoryRepository.saveReport,
// which runs the same projectReportGraph projection and idempotent replace as
// Postgres) replaces a report's normalized rows wholesale:
//   - persisting the SAME report two or more times yields the same claim,
//     citation, and perspective row counts and contents as persisting once,
//     with no duplicate or stale rows (Req 5.2, 5.3);
//   - persisting a report a second time with CHANGED content (same report.id)
//     replaces its rows so they match the latest JSONB payload, leaving no
//     leftover rows from the first version (Req 5.1, 5.2).

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { projectReportGraph } from '../src/core/reportGraph';
import type { AnalysisReport } from '../src/types';
import { gateValidReportArbitrary } from './reportGraph.arb';

// Deterministic content mutation: keeps the SAME report.id but changes the
// report graph so the projection differs from the original. Drops the last
// claim when more than one exists, rewrites the first claim's text and strips
// its citations (a valid honest none/zero-citation state), and drops the last
// perspective. This guarantees changed claim/citation/perspective row contents
// and (when there is room) changed counts.
function mutateContent(report: AnalysisReport): AnalysisReport {
  const kept = report.claims.length > 1 ? report.claims.slice(0, -1) : report.claims;
  const claims = kept.map((claim, i) =>
    i === 0
      ? {
          ...claim,
          claimText: `${claim.claimText} [edited]`,
          evidenceStrength: 'none' as const,
          citations: [],
        }
      : claim,
  );
  const perspectives =
    report.perspectives.length > 0 ? report.perspectives.slice(0, -1) : report.perspectives;
  return { ...report, claims, perspectives };
}

test('Property 5: re-persisting the same report is idempotent (same rows as one save)', async () => {
  await fc.assert(
    fc.asyncProperty(
      gateValidReportArbitrary,
      fc.integer({ min: 2, max: 3 }),
      async (report, saves) => {
        const repo = new InMemoryRepository();
        for (let i = 0; i < saves; i += 1) await repo.saveReport(report);

        // The rows after 2–3 saves equal the projection of a single save: same
        // counts (Req 5.3) and contents, with no duplicate or stale rows (Req 5.2).
        const once = projectReportGraph(report);
        assert.deepEqual(repo.claimRows.get(report.id), once.claims);
        assert.deepEqual(repo.citationRows.get(report.id), once.citations);
        assert.deepEqual(repo.perspectiveRows.get(report.id), once.perspectives);
      },
    ),
    { numRuns: 100 },
  );
});

test('Property 5: re-persisting with changed content replaces rows, leaving no stale rows', async () => {
  await fc.assert(
    fc.asyncProperty(gateValidReportArbitrary, async (report) => {
      const repo = new InMemoryRepository();
      await repo.saveReport(report);

      const mutated = mutateContent(report);
      await repo.saveReport(mutated);

      // Rows now match the latest JSONB payload (Req 5.1) and carry no leftover
      // rows from the first version (Req 5.2) — the row set equals the mutated
      // projection exactly, not a superset of both versions.
      const expected = projectReportGraph(mutated);
      assert.deepEqual(repo.claimRows.get(report.id), expected.claims);
      assert.deepEqual(repo.citationRows.get(report.id), expected.citations);
      assert.deepEqual(repo.perspectiveRows.get(report.id), expected.perspectives);
    }),
    { numRuns: 100 },
  );
});
