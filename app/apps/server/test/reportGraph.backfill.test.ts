// Feature: report-graph-normalization, Property 6: Backfill populates JSONB-only reports, skips populated ones, never mutates JSONB
// Validates: Requirements 8.1, 8.2, 8.3, 8.4
//
// For any set of persisted reports, running the backfill (backfill(repo), which
// reuses the repository's idempotent dual-write) populates normalized rows
// matching projectReportGraph for every report that had none, leaves
// already-populated reports untouched, never alters any report's JSONB payload,
// and produces identical results when run repeatedly.
//
// Simulating the pre-feature state: InMemoryRepository.saveReport ALWAYS
// dual-writes, so there is no public way to land a report as "JSONB only". We
// emulate it by saving every report normally, then deleting the row-map entries
// for the JSONB-only subset — leaving the report present in the report map with
// no normalized rows, exactly the degraded state the backfill repairs.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { projectReportGraph } from '../src/core/reportGraph';
import { backfill } from '../src/scripts/backfill';
import type { AnalysisReport } from '../src/types';
import { gateValidReportArbitrary } from './reportGraph.arb';

// Strip a report's normalized rows so it looks like a pre-feature, JSONB-only
// report: present in the report map (getReport/listReportIds see it) but with no
// claim/citation/perspective rows (hasReportGraph returns false).
function makeJsonbOnly(repo: InMemoryRepository, id: string): void {
  repo.claimRows.delete(id);
  repo.citationRows.delete(id);
  repo.perspectiveRows.delete(id);
}

test('Property 6: backfill populates JSONB-only reports, skips populated, never mutates JSONB, idempotent', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(gateValidReportArbitrary, { minLength: 1, maxLength: 8 }),
      async (rawReports) => {
        // Report ids must be unique within the repo (one report per id). fc.uuid
        // collisions across the array are rare but dedupe makes it total.
        const byId = new Map<string, AnalysisReport>();
        for (const r of rawReports) byId.set(r.id, r);
        const reports = [...byId.values()];

        const repo = new InMemoryRepository();
        for (const report of reports) await repo.saveReport(report);

        // Deterministic split by index parity: even → JSONB-only (rows stripped),
        // odd → already populated (rows left in place).
        const jsonbOnlyIds = new Set<string>();
        const populatedIds = new Set<string>();
        reports.forEach((report, i) => {
          if (i % 2 === 0) {
            makeJsonbOnly(repo, report.id);
            jsonbOnlyIds.add(report.id);
          } else {
            populatedIds.add(report.id);
          }
        });

        // Snapshot every report's JSONB payload before backfill, to prove the
        // backfill never mutates analysis_reports.data (Req 8.4). Compare the
        // JSON-serialized payload — exactly what JSONB stores — so the check is
        // insensitive to object prototypes. fast-check's record arbitraries emit
        // null-prototype sub-objects (e.g. citations); structuredClone would
        // normalize them to Object.prototype and trip a spurious prototype-only
        // mismatch even though every field value is identical.
        const jsonbBefore = new Map<string, string>();
        for (const report of reports) {
          jsonbBefore.set(report.id, JSON.stringify(await repo.getReport(report.id)));
        }

        // ── First backfill run ──
        const summary = await backfill(repo);

        // Summary counts: every JSONB-only report processed, every populated one
        // skipped, none failed.
        assert.equal(summary.processed, jsonbOnlyIds.size); // Req 8.1
        assert.equal(summary.skipped, populatedIds.size); // Req 8.3
        assert.deepEqual(summary.failed, []);

        // Req 8.1 — every previously JSONB-only report now has normalized rows
        // matching the projection of its JSONB payload.
        for (const id of jsonbOnlyIds) {
          const report = byId.get(id)!;
          const expected = projectReportGraph(report);
          assert.deepEqual(repo.claimRows.get(id), expected.claims);
          assert.deepEqual(repo.citationRows.get(id), expected.citations);
          assert.deepEqual(repo.perspectiveRows.get(id), expected.perspectives);
        }

        // Req 8.3 — already-populated reports still hold exactly their projection
        // (untouched, no duplicates).
        for (const id of populatedIds) {
          const report = byId.get(id)!;
          const expected = projectReportGraph(report);
          assert.deepEqual(repo.claimRows.get(id), expected.claims);
          assert.deepEqual(repo.citationRows.get(id), expected.citations);
          assert.deepEqual(repo.perspectiveRows.get(id), expected.perspectives);
        }

        // Req 8.4 — no report's JSONB payload was altered by the backfill.
        for (const id of byId.keys()) {
          assert.equal(JSON.stringify(await repo.getReport(id)), jsonbBefore.get(id));
        }

        // ── Second backfill run: idempotent (Req 8.2) ──
        const summary2 = await backfill(repo);
        // Everything now has rows, so the second run processes nothing and skips all.
        assert.equal(summary2.processed, 0);
        assert.equal(summary2.skipped, reports.length);
        assert.deepEqual(summary2.failed, []);

        // Rows are unchanged after the repeat run — no duplicates or drift.
        for (const id of byId.keys()) {
          const expected = projectReportGraph(byId.get(id)!);
          assert.deepEqual(repo.claimRows.get(id), expected.claims);
          assert.deepEqual(repo.citationRows.get(id), expected.citations);
          assert.deepEqual(repo.perspectiveRows.get(id), expected.perspectives);
        }
      },
    ),
    { numRuns: 100 },
  );
});
