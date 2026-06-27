// Feature: trust-and-launch-bundle, Property 1: Tier classification is total and single-valued.
// For ANY string input, classifyCitationTier never throws and always returns
// exactly one member of the 4-element SourceTier set.
// Validates: Requirements 2.1

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { classifyCitationTier } from '../src/core/sourceTier';
import type { SourceTier } from '../src/types';

const TIER_SET: ReadonlySet<SourceTier> = new Set<SourceTier>([
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
]);

test('Property 1: classifyCitationTier is total and single-valued for any string', () => {
  fc.assert(
    fc.property(
      // Arbitrary garbage strings, real-looking URLs, and bare hosts all exercise
      // the same total contract: a valid tier, every time, with no throw.
      fc.oneof(fc.string(), fc.webUrl(), fc.domain()),
      (input) => {
        const result = classifyCitationTier(input);
        assert.ok(TIER_SET.has(result), `expected a valid SourceTier, got ${String(result)}`);
      },
    ),
    { numRuns: 100 },
  );
});
