// Feature: report-graph-normalization — Backfill failure continuation (task 8.2).
// Validates: Requirements 8.5
//
// A single report failing to backfill must never abort the run: the
// Backfill_Command catches the per-report error, records the failed report_id,
// and continues with the remaining reports. This example test seeds several
// JSONB-only reports (payload persisted, normalized rows stripped — the
// pre-feature state the backfill repairs) plus one report whose normalized
// write throws, runs backfill(repo), and asserts the good reports were
// populated, the failing report_id is reported, and the failing report still
// has no rows.

import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepository } from '../src/infra/memory';
import { projectReportGraph } from '../src/core/reportGraph';
import { backfill } from '../src/scripts/backfill';
import type { AnalysisReport } from '../src/types';

// A gate-valid report with one cited claim and a perspective, so the projection
// produces rows the backfill's dual-write would populate. Hand-built — this is
// an example test, not a property.
function makeReport(id: string): AnalysisReport {
  return {
    id,
    contentId: `content-${id}`,
    urlHash: `hash-${id}`,
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    tldr: 'A short summary.',
    issueFrame: { label: 'Test frame', x: 0, y: 0 },
    claims: [
      {
        id: `${id}-claim-1`,
        claimText: 'A verifiable claim.',
        verifiability: 'verifiable',
        evidenceStrength: 'moderate',
        confidence: 0.8,
        citations: [
          {
            sourceUrl: 'https://example.org/a',
            sourceName: 'Example Org',
            sourceTier: 'tier2_institutional',
            excerpt: 'supporting excerpt',
            supports: true,
          },
        ],
      },
    ],
    framingSignals: [],
    contextCards: [],
    perspectives: [
      {
        url: 'https://example.com/p',
        sourceName: 'Other View',
        sourceTier: 'tier3_viewpoint',
        issueFrameLabel: 'Other frame',
        divergence: 0.5,
        dehumanization: 0.1,
      },
    ],
    confidence: 0.8,
    shareSlug: `slug-${id}`,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

// InMemoryRepository whose saveReport throws for one specific report id (the
// per-report failure the backfill must survive), delegating to the real
// dual-write for every other report. seedJsonbOnly writes a report via the base
// dual-write then strips its normalized rows — leaving the JSONB-only state
// (hasReportGraph(id) === false) that the backfill exists to repair.
class FailingBackfillRepo extends InMemoryRepository {
  constructor(private readonly failId: string) {
    super();
  }

  async seedJsonbOnly(report: AnalysisReport): Promise<void> {
    await super.saveReport(report); // persists JSONB payload + projects rows
    this.claimRows.delete(report.id); // strip rows -> JSONB-only (pre-feature) state
    this.citationRows.delete(report.id);
    this.perspectiveRows.delete(report.id);
  }

  override async saveReport(report: AnalysisReport): Promise<void> {
    if (report.id === this.failId) {
      throw new Error(`forced normalized-write failure for ${report.id}`);
    }
    return super.saveReport(report);
  }
}

test('backfill populates good reports and reports the failed report_id without aborting', async () => {
  const goodIds = ['good-1', 'good-2', 'good-3'];
  const failId = 'bad-1';
  const repo = new FailingBackfillRepo(failId);

  // Seed all reports as JSONB-only (no normalized rows yet).
  for (const id of [...goodIds, failId]) {
    await repo.seedJsonbOnly(makeReport(id));
  }

  // Sanity: none of the reports has a graph before the backfill runs.
  for (const id of [...goodIds, failId]) {
    assert.equal(await repo.hasReportGraph(id), false, `${id} should start JSONB-only`);
  }

  // Req 8.5: a single report's failure must not abort the run.
  const summary = await backfill(repo);

  // The good reports were populated, and their rows match the pure projection.
  for (const id of goodIds) {
    assert.equal(await repo.hasReportGraph(id), true, `${id} should be populated`);
    const expected = projectReportGraph(makeReport(id));
    assert.deepEqual(repo.claimRows.get(id), expected.claims, `${id} claim rows`);
    assert.deepEqual(repo.citationRows.get(id), expected.citations, `${id} citation rows`);
    assert.deepEqual(repo.perspectiveRows.get(id), expected.perspectives, `${id} perspective rows`);
  }

  // Req 8.5: the failed report_id is reported, and only that one failed.
  assert.deepEqual(summary.failed, [failId], 'only the failing report_id is reported');
  assert.equal(summary.processed, goodIds.length, 'every good report was processed');
  assert.equal(summary.skipped, 0, 'nothing was skipped — all started JSONB-only');

  // The failing report still has no normalized rows (its write never succeeded).
  assert.equal(await repo.hasReportGraph(failId), false, 'failing report stays unpopulated');
  assert.equal(repo.claimRows.get(failId), undefined, 'no claim rows for the failing report');
});
