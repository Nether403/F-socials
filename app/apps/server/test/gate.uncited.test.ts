// Feature: trust-and-launch-bundle, Property 17: An uncited claim that asserts
// evidence (evidenceStrength weak/moderate/strong with zero citations) holds the
// report at 'needs_review' and records a reason identifying the uncited claim.
// Validates: Requirements 6.1
//
// The gate (core/assemble.ts) is the codified moat — this test only verifies it,
// it does not (and must not) edit it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { assembleReport, type AssembleInput } from '../src/core/assemble';
import type { Claim, Citation, FramingSignal } from '../src/types';

const ASSERTING: ReadonlyArray<Claim['evidenceStrength']> = ['weak', 'moderate', 'strong'];

function citation(): Citation {
  return {
    sourceUrl: 'https://example.org/s',
    sourceName: 'Src',
    sourceTier: 'tier2_institutional',
    supports: null,
  };
}

// A claim that asserts evidence (weak/moderate/strong) but carries zero citations:
// this is overclaiming and must force needs_review with a citation reason.
const uncitedAssertingArb: fc.Arbitrary<Claim> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  claimText: fc.string({ minLength: 1, maxLength: 40 }),
  verifiability: fc.constantFrom('verifiable', 'partially_verifiable', 'opinion', 'unverifiable'),
  evidenceStrength: fc.constantFrom(...ASSERTING),
  confidence: fc.float({ min: 0, max: 1, noNaN: true }),
}).map((c) => ({ ...c, citations: [] as Citation[] }));

// A well-formed cited claim (asserts evidence AND has a citation) — does not trip the gate.
const citedArb: fc.Arbitrary<Claim> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  claimText: fc.string({ minLength: 1, maxLength: 40 }),
  verifiability: fc.constantFrom('verifiable', 'partially_verifiable', 'opinion', 'unverifiable'),
  evidenceStrength: fc.constantFrom(...ASSERTING),
  confidence: fc.float({ min: 0, max: 1, noNaN: true }),
}).map((c) => ({ ...c, citations: [citation()] }));

// An honest "none" claim with zero citations — a VALID state, must NOT trip the gate.
const noneArb: fc.Arbitrary<Claim> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  claimText: fc.string({ minLength: 1, maxLength: 40 }),
  verifiability: fc.constantFrom('verifiable', 'partially_verifiable', 'opinion', 'unverifiable'),
  confidence: fc.float({ min: 0, max: 1, noNaN: true }),
}).map((c) => ({ ...c, evidenceStrength: 'none' as const, citations: [] as Citation[] }));

function goodSignal(): FramingSignal {
  return {
    technique: 'Emotional Language',
    severity: 'medium',
    description: 'High-arousal wording that primes the reader.',
    examples: [
      { text: 'They ALWAYS lie!', explanation: 'Absolutist phrasing.', startIndex: 0, endIndex: 16 },
    ],
  };
}

test('Property 17: an uncited evidence-asserting claim forces needs_review with a citation reason', () => {
  fc.assert(
    fc.property(
      // a varied set of other claims (cited + honest-none, possibly empty)...
      fc.array(fc.oneof(citedArb, noneArb), { maxLength: 6 }),
      // ...at least one uncited evidence-asserting claim...
      fc.array(uncitedAssertingArb, { minLength: 1, maxLength: 4 }),
      // ...inserted at an arbitrary position...
      fc.nat(),
      // ...with varied confidence (kept above the floor so the citation reason is the cause).
      fc.float({ min: Math.fround(0.4), max: 1, noNaN: true }),
      (others, overclaimed, insertAt, confidence) => {
        const claims = [...others];
        const pos = others.length === 0 ? 0 : insertAt % (others.length + 1);
        claims.splice(pos, 0, ...overclaimed);

        const input: AssembleInput = {
          tldr: 'summary',
          issueFrame: { label: 'mixed', x: 0, y: 0 },
          claims,
          framingSignals: [goodSignal()],
          contextCards: [],
          perspectives: [],
          confidence,
        };

        const r = assembleReport(input);

        // The presence of an uncited evidence-asserting claim forces needs_review...
        assert.equal(r.status, 'needs_review');
        // ...and a reason identifying the uncited claim(s) (mentions 'citation').
        assert.ok(
          r.reasons.some((m) => m.toLowerCase().includes('citation')),
          `expected a citation reason, got: ${JSON.stringify(r.reasons)}`,
        );
      },
    ),
    { numRuns: 200 },
  );
});
