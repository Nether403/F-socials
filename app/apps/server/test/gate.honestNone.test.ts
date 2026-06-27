// Feature: trust-and-launch-bundle, Property 18: An honest "none" claim with no
// citations does not block readiness.
//
// For any report whose ONLY would-be citation issue is claims with evidenceStrength
// 'none' and zero citations (all other claims properly cited, framing valid,
// confidence above floor, >=1 claim present), assembleReport records NO citation
// reason for those 'none' claims and the report reaches 'ready'.
// Validates: Requirements 6.2

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { assembleReport, CONFIDENCE_FLOOR, type AssembleInput } from '../src/core/assemble';
import type { Claim, Citation, FramingSignal } from '../src/types';

const tierArb = fc.constantFrom(
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
) as fc.Arbitrary<Citation['sourceTier']>;

function citationArb(): fc.Arbitrary<Citation> {
  return fc.record({
    sourceUrl: fc.webUrl(),
    sourceName: fc.string({ minLength: 1, maxLength: 20 }),
    sourceTier: tierArb,
    supports: fc.constantFrom(true, false, null),
  });
}

// A properly cited claim: asserts weak/moderate/strong AND carries >=1 citation.
function citedClaimArb(): fc.Arbitrary<Claim> {
  return fc.record({
    id: fc.uuid(),
    claimText: fc.string({ minLength: 1, maxLength: 40 }),
    verifiability: fc.constantFrom('verifiable', 'partially_verifiable', 'opinion', 'unverifiable'),
    evidenceStrength: fc.constantFrom('strong', 'moderate', 'weak'),
    confidence: fc.float({ min: 0, max: 1, noNaN: true }),
    citations: fc.array(citationArb(), { minLength: 1, maxLength: 4 }),
  }) as fc.Arbitrary<Claim>;
}

// An honest "none" claim: evidenceStrength 'none' AND zero citations.
function honestNoneClaimArb(): fc.Arbitrary<Claim> {
  return fc.record({
    id: fc.uuid(),
    claimText: fc.string({ minLength: 1, maxLength: 40 }),
    verifiability: fc.constantFrom('verifiable', 'partially_verifiable', 'opinion', 'unverifiable'),
    evidenceStrength: fc.constant('none'),
    confidence: fc.float({ min: 0, max: 1, noNaN: true }),
    citations: fc.constant([]),
  }) as fc.Arbitrary<Claim>;
}

// A valid framing signal: >=1 example, each with a non-empty quote + explanation.
function goodSignalArb(): fc.Arbitrary<FramingSignal> {
  return fc.record({
    technique: fc.string({ minLength: 1, maxLength: 20 }),
    severity: fc.constantFrom('low', 'medium', 'high'),
    description: fc.string({ minLength: 1, maxLength: 30 }),
    examples: fc.array(
      fc.record({
        text: fc.string({ minLength: 1, maxLength: 30 }).map((s) => s + 'x'),
        explanation: fc.string({ minLength: 1, maxLength: 30 }).map((s) => s + 'x'),
        startIndex: fc.integer({ min: -1, max: 100 }),
        endIndex: fc.integer({ min: -1, max: 100 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  }) as fc.Arbitrary<FramingSignal>;
}

test('Property 18: honest "none" claims (0 citations) never block readiness', () => {
  const inputArb: fc.Arbitrary<AssembleInput> = fc
    .record({
      // varied numbers of honest-none claims mixed with properly-cited claims;
      // at least one claim present overall.
      citedClaims: fc.array(citedClaimArb(), { minLength: 0, maxLength: 5 }),
      noneClaims: fc.array(honestNoneClaimArb(), { minLength: 0, maxLength: 5 }),
      framingSignals: fc.array(goodSignalArb(), { minLength: 1, maxLength: 3 }),
      // confidence strictly above the floor so it is never the blocker.
      confidence: fc.float({ min: Math.fround(CONFIDENCE_FLOOR), max: 1, noNaN: true }),
    })
    .filter((r) => r.citedClaims.length + r.noneClaims.length >= 1 && r.confidence >= CONFIDENCE_FLOOR)
    .map((r) => ({
      tldr: 'summary',
      issueFrame: { label: 'mixed', x: 0, y: 0 },
      // interleave none + cited claims
      claims: [...r.citedClaims, ...r.noneClaims],
      framingSignals: r.framingSignals,
      contextCards: [],
      perspectives: [],
      confidence: r.confidence,
    }));

  fc.assert(
    fc.property(inputArb, (input) => {
      const result = assembleReport(input);

      // The ONLY would-be citation issue is the honest-none claims, which are valid.
      // So no citation reason should be recorded and the report must be ready.
      assert.ok(
        !result.reasons.some((m) => m.includes('citation')),
        `unexpected citation reason: ${JSON.stringify(result.reasons)}`,
      );
      assert.equal(result.status, 'ready', `reasons: ${JSON.stringify(result.reasons)}`);
    }),
    { numRuns: 200 },
  );
});
