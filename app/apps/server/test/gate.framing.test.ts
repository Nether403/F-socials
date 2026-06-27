// Feature: trust-and-launch-bundle, Property 19: A framing signal lacking evidence
// holds the report for review.
//
// For any report containing a framing signal with zero examples, OR an example whose
// quote is empty/whitespace, OR an example whose explanation is empty/whitespace, the
// invariant gate (core/assemble.ts) sets status to 'needs_review' AND records a reason
// identifying the deficient framing signal (a reason mentioning 'framing'). Everything
// else in the report is kept valid so the framing deficiency is the trigger.
//
// Validates: Requirements 6.3

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { assembleReport, CONFIDENCE_FLOOR, type AssembleInput } from '../src/core/assemble';
import type { Claim, FramingExample, FramingSignal } from '../src/types';

// A blank string: empty, or only whitespace (spaces, tabs, newlines).
const blank = fc.constantFrom('', ' ', '   ', '\t', '\n', ' \t\n ');

// A non-blank string that trims to something (so valid fields are genuinely present).
const nonBlank = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

// An otherwise-valid framing example (both quote + explanation present).
const validExample: fc.Arbitrary<FramingExample> = fc.record({
  text: nonBlank,
  explanation: nonBlank,
  startIndex: fc.integer({ min: 0, max: 1000 }),
  endIndex: fc.integer({ min: 0, max: 1000 }),
});

// The three deficiency variants, any of which must trigger needs_review.
const deficientSignal: fc.Arbitrary<FramingSignal> = fc.oneof(
  // 1. zero examples
  fc.record({
    technique: nonBlank,
    severity: fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
    description: nonBlank,
    examples: fc.constant<FramingExample[]>([]),
  }),
  // 2. an example whose quote (text) is blank
  fc.record({
    technique: nonBlank,
    severity: fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
    description: nonBlank,
    examples: fc
      .tuple(
        fc.record({
          text: blank,
          explanation: nonBlank,
          startIndex: fc.integer({ min: 0, max: 1000 }),
          endIndex: fc.integer({ min: 0, max: 1000 }),
        }),
        fc.array(validExample, { maxLength: 3 }),
      )
      .map(([bad, rest]) => [...rest, bad]),
  }),
  // 3. an example whose explanation is blank
  fc.record({
    technique: nonBlank,
    severity: fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
    description: nonBlank,
    examples: fc
      .tuple(
        fc.record({
          text: nonBlank,
          explanation: blank,
          startIndex: fc.integer({ min: 0, max: 1000 }),
          endIndex: fc.integer({ min: 0, max: 1000 }),
        }),
        fc.array(validExample, { maxLength: 3 }),
      )
      .map(([bad, rest]) => [...rest, bad]),
  }),
);

// A fully valid, cited claim — keeps the citation invariant satisfied so framing is
// the only trigger.
const validClaim: fc.Arbitrary<Claim> = fc.record({
  id: nonBlank,
  claimText: nonBlank,
  verifiability: fc.constant('verifiable' as const),
  evidenceStrength: fc.constantFrom('weak' as const, 'moderate' as const, 'strong' as const),
  confidence: fc.float({ min: 0, max: 1, noNaN: true }),
  citations: fc.array(
    fc.record({
      sourceUrl: fc.constant('https://example.org/s'),
      sourceName: nonBlank,
      sourceTier: fc.constant('tier2_institutional' as const),
      supports: fc.constantFrom(true, false, null),
    }),
    { minLength: 1, maxLength: 3 },
  ),
});

// A valid framing signal (used to mix in alongside the deficient one).
const validSignal: fc.Arbitrary<FramingSignal> = fc.record({
  technique: nonBlank,
  severity: fc.constantFrom('low' as const, 'medium' as const, 'high' as const),
  description: nonBlank,
  examples: fc.array(validExample, { minLength: 1, maxLength: 3 }),
});

const reportWithDeficientFraming: fc.Arbitrary<AssembleInput> = fc.record({
  tldr: fc.string(),
  issueFrame: fc.record({ label: nonBlank, x: fc.float({ noNaN: true }), y: fc.float({ noNaN: true }) }),
  claims: fc.array(validClaim, { minLength: 1, maxLength: 4 }),
  framingSignals: fc
    .tuple(deficientSignal, fc.array(validSignal, { maxLength: 3 }))
    // interleave so the deficient signal isn't always first
    .map(([bad, good]) => [...good, bad]),
  contextCards: fc.constant([]),
  perspectives: fc.constant([]),
  // confidence kept at/above the floor so it is not a competing trigger
  confidence: fc.float({ min: Math.fround(CONFIDENCE_FLOOR), max: 1, noNaN: true }),
});

test('Property 19: a framing signal lacking evidence holds the report for review', () => {
  fc.assert(
    fc.property(reportWithDeficientFraming, (input) => {
      const r = assembleReport(input);
      assert.equal(r.status, 'needs_review');
      assert.ok(
        r.reasons.some((m) => m.toLowerCase().includes('framing')),
        `expected a reason mentioning 'framing', got: ${JSON.stringify(r.reasons)}`,
      );
    }),
    { numRuns: 200 },
  );
});
