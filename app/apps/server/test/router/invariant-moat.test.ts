// Feature: claim-verification-router, Property 12: Strength and citations are always consistent — the invariant moat
// For ANY verifyClaim output, if evidenceStrength is weak/moderate/strong then the claim carries at least one
// Citation, and if evidenceStrength is none then the claim carries zero Citations; consequently a
// no_sufficient_evidence or relevant_context_only outcome attaches zero citations and remains a valid served
// state that the unchanged Invariant_Gate accepts as ready.
// Validates: Requirements 9.3, 9.4, 7.1, 7.2, 7.3

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { verifyClaim, type VerifyDeps } from '../../src/router/index';
import { assembleReport } from '../../src/core/assemble';
import type { CandidateValidator, ClaimNormalizer } from '../../src/providers/types';
import type {
  Candidate,
  Claim,
  EvidenceStrength,
  FactCheckability,
  MatchType,
  QueryVariant,
  SourceTier,
} from '../../src/types';

const MATCH_TYPES: readonly MatchType[] = [
  'same_claim',
  'same_topic_different_claim',
  'background_context',
  'contradictory_but_relevant',
  'irrelevant',
];

const SOURCE_TIERS: readonly SourceTier[] = [
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
];

const STRENGTH_WITH_CITATIONS: ReadonlySet<EvidenceStrength> = new Set<EvidenceStrength>([
  'weak',
  'moderate',
  'strong',
]);

// One generated candidate's controlled signals. matchType + sourceTier + isFactCheck
// fully drive routing/outcome; the URL is unique so the stub validator can look the
// candidate's verdict up by it (the router classifies against the ORIGINAL claim, so
// the validator's input is the claim, but its OUTPUT here is keyed to the candidate).
interface CandidateSpec {
  matchType: MatchType;
  sourceTier: SourceTier;
  isFactCheck: boolean;
  matchConfidence: number;
}

const candidateSpecArb: fc.Arbitrary<CandidateSpec> = fc.record({
  matchType: fc.constantFrom(...MATCH_TYPES),
  sourceTier: fc.constantFrom(...SOURCE_TIERS),
  isFactCheck: fc.boolean(),
  // Boundary confidences 0 and 1 plus the interior — the gate must not depend on it.
  matchConfidence: fc.oneof(
    fc.constant(0),
    fc.constant(1),
    fc.float({ min: 0, max: 1, noNaN: true }),
  ),
});

const factCheckabilityArb: fc.Arbitrary<FactCheckability> = fc.constantFrom(
  'checkable',
  'not_fact_checkable',
);

// Build deps that drive verifyClaim to a broad range of outcomes:
//   - a stub normalizer forces the generated Fact_Checkability (so the
//     not_fact_checkable short-circuit and the full checkable path are both hit),
//   - a stub retrieve emits the generated candidate set exactly once (each candidate
//     carries its tier/origin directly, including `excluded`),
//   - a stub validator returns each candidate's generated Match_Type/Confidence,
//     classifying against the ORIGINAL claim per the interface.
function makeDeps(originalClaim: string, factCheckability: FactCheckability, specs: CandidateSpec[]): VerifyDeps {
  const normalizer: ClaimNormalizer = {
    async normalize(claim: string) {
      return {
        canonicalClaim: claim.trim() || 'placeholder canonical claim',
        claimType: factCheckability === 'checkable' ? 'factual_event' : 'normative_opinion',
        factCheckability,
      };
    },
  };

  // sourceUrl -> verdict lookup, so the validator's per-candidate output is the
  // generated Match_Type even though it is invoked with the original claim.
  const verdicts = new Map<string, { matchType: MatchType; matchConfidence: number }>();
  const candidates: Candidate[] = specs.map((spec, i) => {
    const sourceUrl = `https://example.com/candidate/${i}`;
    verdicts.set(sourceUrl, { matchType: spec.matchType, matchConfidence: spec.matchConfidence });
    return {
      sourceUrl,
      sourceName: `Source ${i}`,
      excerpt: `excerpt ${i}`,
      sourceTier: spec.sourceTier,
      isFactCheck: spec.isFactCheck,
      fromVariant: 'exact_normalized',
      retrievalRank: i,
    };
  });

  const validator: CandidateValidator = {
    async validate(claim: string, candidate: Candidate) {
      // Sanity: the router must pass the ORIGINAL claim, never a variant text.
      assert.equal(claim, originalClaim);
      return verdicts.get(candidate.sourceUrl) ?? { matchType: 'irrelevant', matchConfidence: 0 };
    },
  };

  // Emit the full candidate set once (on the first variant), empty thereafter, so each
  // generated candidate is validated exactly once regardless of pack size.
  let emitted = false;
  const retrieve = async (_variant: QueryVariant): Promise<Candidate[]> => {
    if (emitted) return [];
    emitted = true;
    return candidates;
  };

  return { normalizer, validator, retrieve, classifyTier: () => 'excluded' };
}

// The honest-none outcome and every cited outcome must be a valid served `ready`
// state. Wrap the verified claim in an otherwise-clean report and assert the
// UNCHANGED Invariant_Gate accepts it — this is the moat the router protects by
// construction (strength<->citation consistency is exactly what the gate checks).
function assertGateAcceptsAsReady(claimText: string, strength: EvidenceStrength, citations: Claim['citations']): void {
  const claim: Claim = {
    id: 'claim-under-test',
    claimText: claimText.trim() || 'placeholder claim',
    verifiability: 'verifiable',
    evidenceStrength: strength,
    confidence: 0.9,
    citations,
  };
  const result = assembleReport({
    tldr: 'A non-empty summary.',
    issueFrame: { label: 'test', x: 0, y: 0 },
    claims: [claim],
    framingSignals: [],
    contextCards: [],
    perspectives: [],
    confidence: 0.9,
  });
  assert.equal(
    result.status,
    'ready',
    `the Invariant_Gate must accept the router's output as ready, got needs_review: ${result.reasons.join('; ')}`,
  );
}

test('Property 12: strength and citations are always consistent — the invariant moat', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string(),
      factCheckabilityArb,
      fc.array(candidateSpecArb, { minLength: 0, maxLength: 25 }),
      async (originalClaim, factCheckability, specs) => {
        const deps = makeDeps(originalClaim, factCheckability, specs);
        const out = await verifyClaim(originalClaim, deps);

        // The moat (Req 9.3, 9.4): strength <-> citation count consistency.
        if (STRENGTH_WITH_CITATIONS.has(out.evidenceStrength)) {
          assert.ok(
            out.citations.length >= 1,
            `strength ${out.evidenceStrength} must carry >= 1 citation, got ${out.citations.length}`,
          );
        } else {
          // evidenceStrength === 'none'
          assert.equal(out.evidenceStrength, 'none');
          assert.equal(
            out.citations.length,
            0,
            `strength none must carry 0 citations, got ${out.citations.length}`,
          );
        }

        // Consequence (Req 7.1, 7.2): the honest no-evidence / context-only outcomes
        // attach zero cited evidence for the claim.
        if (
          out.evidenceOutcome === 'no_sufficient_evidence' ||
          out.evidenceOutcome === 'relevant_context_only'
        ) {
          assert.equal(out.evidenceStrength, 'none');
          assert.equal(
            out.citations.length,
            0,
            `${out.evidenceOutcome} must attach zero citations, got ${out.citations.length}`,
          );
        }

        // Req 7.3 / the moat end-to-end: feed the resulting claim into the UNCHANGED
        // Invariant_Gate and confirm it is a valid served `ready` state for every
        // outcome the router can produce — including honest-none.
        assertGateAcceptsAsReady(originalClaim, out.evidenceStrength, out.citations);
      },
    ),
    { numRuns: 200 },
  );
});
