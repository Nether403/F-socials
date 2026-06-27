// Feature: trust-and-launch-bundle, Property 20: Readiness is exactly the
// absence of review reasons — the invariant gate sets status to 'ready' iff
// reasons.length === 0, and 'needs_review' otherwise.
// Validates: Requirements 6.4

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { assembleReport, type AssembleInput } from '../src/core/assemble';
import type { Citation, Claim, FramingSignal, EvidenceStrength, SourceTier } from '../src/types';

const tiers: SourceTier[] = ['tier1_primary', 'tier2_institutional', 'tier3_viewpoint', 'excluded'];
const strengths: EvidenceStrength[] = ['strong', 'moderate', 'weak', 'none'];

const citationArb: fc.Arbitrary<Citation> = fc.record({
  sourceUrl: fc.webUrl(),
  sourceName: fc.string(),
  sourceTier: fc.constantFrom(...tiers),
  supports: fc.constantFrom(true, false, null),
});

// A claim with any evidence strength and 0..n citations — exercises both the
// honest 'none'/no-citation state and the overclaiming state.
const claimArb: fc.Arbitrary<Claim> = fc.record({
  id: fc.string({ minLength: 1 }),
  claimText: fc.string(),
  verifiability: fc.constantFrom('verifiable', 'partially_verifiable', 'opinion', 'unverifiable'),
  evidenceStrength: fc.constantFrom(...strengths),
  confidence: fc.float({ min: 0, max: 1, noNaN: true }),
  citations: fc.array(citationArb, { maxLength: 3 }),
});

// Framing signals that are valid (examples with real text + explanation) as well
// as deficient (no examples, or examples missing text/explanation).
const framingSignalArb: fc.Arbitrary<FramingSignal> = fc.record({
  technique: fc.string(),
  severity: fc.constantFrom('low', 'medium', 'high'),
  description: fc.string(),
  examples: fc.array(
    fc.record({
      // mix blank and non-blank to exercise the "deficient" branch
      text: fc.oneof(fc.constant(''), fc.constant('   '), fc.string({ minLength: 1 })),
      explanation: fc.oneof(fc.constant(''), fc.constant('  '), fc.string({ minLength: 1 })),
      startIndex: fc.integer({ min: -1, max: 1000 }),
      endIndex: fc.integer({ min: -1, max: 1000 }),
    }),
    { maxLength: 3 },
  ),
});

const inputArb: fc.Arbitrary<AssembleInput> = fc.record({
  tldr: fc.string(),
  issueFrame: fc.record({
    label: fc.string(),
    x: fc.float({ min: -1, max: 1, noNaN: true }),
    y: fc.float({ min: -1, max: 1, noNaN: true }),
  }),
  // empty and non-empty claim sets
  claims: fc.array(claimArb, { maxLength: 5 }),
  framingSignals: fc.array(framingSignalArb, { maxLength: 4 }),
  contextCards: fc.constant([]),
  perspectives: fc.constant([]),
  // confidence above and below the floor (0.4)
  confidence: fc.float({ min: 0, max: 1, noNaN: true }),
});

test('Property 20: status === "ready" iff reasons.length === 0', () => {
  fc.assert(
    fc.property(inputArb, (input) => {
      const r = assembleReport(input);
      const ready = r.status === 'ready';
      const noReasons = r.reasons.length === 0;
      // biconditional: ready <=> no reasons
      assert.equal(ready, noReasons);
      // exhaustive: status is exactly one of the two values
      assert.ok(r.status === 'ready' || r.status === 'needs_review');
      // and needs_review is exactly the complement
      assert.equal(r.status === 'needs_review', r.reasons.length > 0);
    }),
    { numRuns: 200 },
  );
});
