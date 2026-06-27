// Feature: report-graph-normalization, Property 7: Tiers attach to sources only — no creator-reliability dimension
// Validates: Requirements 9.2
//
// For any gate-valid report, no projected claim row carries a source-tier or any
// reliability/truthfulness rating; sourceTier appears only on citation and
// perspective rows (which describe sources). We assert against the ACTUAL keys
// present on the row objects (Object.keys), so the test catches any creator-
// reliability dimension that might be introduced on a claim row in the future,
// and confirms every citation/perspective row carries a valid sourceTier.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import type { SourceTier } from '../src/types';
import { gateValidReportArbitrary } from './reportGraph.arb';

// The full SourceTier union — sources only ever carry one of these.
const VALID_TIERS = new Set<SourceTier>([
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
]);

// Keys that would betray a creator-reliability / truthfulness dimension on a
// claim row. A claim row describes a CLAIM, not a source, so none of these —
// nor a bare source-tier — may ever appear on it.
const FORBIDDEN_CLAIM_KEY = /tier|reliab|trust|verdict|rating|credib|truth/i;

test('Property 7: source tiers attach to sources only, never to claim rows', async () => {
  await fc.assert(
    fc.asyncProperty(gateValidReportArbitrary, async (report) => {
      const repo = new InMemoryRepository();
      await repo.saveReport(report);

      const claimRows = repo.claimRows.get(report.id) ?? [];
      const citationRows = repo.citationRows.get(report.id) ?? [];
      const perspectiveRows = repo.perspectiveRows.get(report.id) ?? [];

      // No claim row carries a source-tier or any reliability/truthfulness key.
      for (const row of claimRows) {
        const keys = Object.keys(row);
        assert.ok(
          !keys.includes('sourceTier'),
          `claim row exposes a sourceTier dimension: ${keys.join(', ')}`,
        );
        for (const key of keys) {
          assert.ok(
            !FORBIDDEN_CLAIM_KEY.test(key),
            `claim row exposes a creator-reliability/verdict key "${key}"`,
          );
        }
      }

      // sourceTier appears only on rows describing sources — citations and
      // perspectives — and is always a valid tier value.
      for (const row of citationRows) {
        assert.ok(
          Object.keys(row).includes('sourceTier'),
          'citation row must carry a sourceTier',
        );
        assert.ok(
          VALID_TIERS.has(row.sourceTier),
          `citation row has invalid sourceTier: ${String(row.sourceTier)}`,
        );
      }
      for (const row of perspectiveRows) {
        assert.ok(
          Object.keys(row).includes('sourceTier'),
          'perspective row must carry a sourceTier',
        );
        assert.ok(
          VALID_TIERS.has(row.sourceTier),
          `perspective row has invalid sourceTier: ${String(row.sourceTier)}`,
        );
      }
    }),
    { numRuns: 100 },
  );
});
