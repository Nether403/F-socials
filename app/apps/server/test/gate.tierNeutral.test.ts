// Feature: trust-and-launch-bundle, Property 21: Tier classification does not
// change the gate outcome. Running each citation's sourceTier through
// classifyCitationTier (annotation only — no citation is added, removed, or
// re-framed) must leave assembleReport's status and reasons identical. If
// tiering could ever flip the gate, the source-tier policy would have become a
// judge; this test fails the moment that happens.

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { assembleReport, type AssembleInput } from '../src/core/assemble';
import { classifyCitationTier } from '../src/core/sourceTier';
import type { Citation, Claim, EvidenceStrength, FramingSignal, SourceTier } from '../src/types';

const SOURCE_TIERS: SourceTier[] = [
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
];
const EVIDENCE_STRENGTHS: EvidenceStrength[] = ['strong', 'moderate', 'weak', 'none'];

// Varied source URLs: institutional/primary/viewpoint hosts plus unresolvable
// junk, so classifyCitationTier produces every tier across generated reports.
const sourceUrlArb = fc.constantFrom(
  'https://www.bbc.co.uk/news/x',
  'https://example.gov/report',
  'https://nature.com/articles/y',
  'https://randomblog.example/post',
  'https://ec.europa.eu/eurostat/data',
  'not a url',
  '',
  'localhost',
);

const citationArb: fc.Arbitrary<Citation> = fc.record({
  sourceUrl: sourceUrlArb,
  sourceName: fc.constantFrom('Src A', 'Src B', 'Src C'),
  sourceTier: fc.constantFrom(...SOURCE_TIERS),
  supports: fc.constantFrom(true, false, null),
});

const claimArb: fc.Arbitrary<Claim> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  claimText: fc.string(),
  verifiability: fc.constantFrom('verifiable', 'partially_verifiable', 'opinion', 'unverifiable'),
  evidenceStrength: fc.constantFrom(...EVIDENCE_STRENGTHS),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  // 0..3 citations so we cover cited, uncited, and none-strength-uncited claims.
  citations: fc.array(citationArb, { maxLength: 3 }),
});

const framingExampleArb = fc.record({
  // include empty quotes/explanations so "deficient framing" reports are generated.
  text: fc.constantFrom('They ALWAYS lie!', '', '   '),
  explanation: fc.constantFrom('Absolutist phrasing.', '', '   '),
  startIndex: fc.integer({ min: -1, max: 50 }),
  endIndex: fc.integer({ min: -1, max: 50 }),
});

const framingSignalArb: fc.Arbitrary<FramingSignal> = fc.record({
  technique: fc.constantFrom('Emotional Language', 'Us vs. Them'),
  severity: fc.constantFrom('low', 'medium', 'high'),
  description: fc.string(),
  examples: fc.array(framingExampleArb, { maxLength: 3 }),
});

const reportArb: fc.Arbitrary<AssembleInput> = fc.record({
  tldr: fc.string(),
  issueFrame: fc.record({
    label: fc.constantFrom('left', 'mixed', 'right'),
    x: fc.double({ min: -1, max: 1, noNaN: true }),
    y: fc.double({ min: -1, max: 1, noNaN: true }),
  }),
  claims: fc.array(claimArb, { maxLength: 5 }),
  framingSignals: fc.array(framingSignalArb, { maxLength: 4 }),
  contextCards: fc.constant([]),
  perspectives: fc.constant([]),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
});

// Build a tiered copy: replace each citation's sourceTier with the policy's
// classification of its URL. Annotation only — count, order, and every other
// field the gate inspects are untouched.
function tiered(input: AssembleInput): AssembleInput {
  return {
    ...input,
    claims: input.claims.map((c) => ({
      ...c,
      citations: c.citations.map((cit) => ({
        ...cit,
        sourceTier: classifyCitationTier(cit.sourceUrl),
      })),
    })),
  };
}

test('Property 21: classifying citation tiers does not change the gate outcome', () => {
  fc.assert(
    fc.property(reportArb, (input) => {
      const original = assembleReport(input);
      const annotated = assembleReport(tiered(input));
      assert.equal(annotated.status, original.status);
      assert.deepEqual(annotated.reasons, original.reasons);
    }),
    { numRuns: 200 },
  );
});
