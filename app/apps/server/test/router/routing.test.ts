// Feature: claim-verification-router, Property 8: Candidate routing honors match type and the excluded-tier hard gate
// For ANY set of validated candidates, a candidate enters the Claim_Ledger as a citation IF AND ONLY IF
// its Match_Type is same_claim or contradictory_but_relevant AND its Source_Tier is not excluded;
// a contradictory_but_relevant citation is recorded with supports === false; same_topic_different_claim
// candidates go only to Useful_Context; background_context candidates go only to a Context_Card;
// irrelevant candidates appear nowhere; and a candidate with Source_Tier === 'excluded' never appears
// as a citation regardless of its Match_Type or Match_Confidence. Holds for single-query or full-pack retrieval.
// Validates: Requirements 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 5.2, 7.4

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { routeCandidates, isLedgerEligible } from '../../src/router/outcome';
import type {
  Candidate,
  MatchType,
  SourceTier,
  QueryVariantKind,
  ValidatedCandidate,
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

const VARIANT_KINDS: readonly QueryVariantKind[] = [
  'exact_normalized',
  'compressed_entity_predicate',
  'fact_check_style',
  'counterclaim_negated',
  'source_language',
  'english',
];

// A ValidatedCandidate generator that drives the whole gate input space: all five
// Match_Types, all four Source_Tiers (including `excluded`), both provider origins,
// and boundary confidences 0 and 1 (plus arbitrary in-range values). selectedAsEvidence
// is generated arbitrarily on purpose — routeCandidates must recompute it from the gate,
// never trust the incoming value.
const validatedArb: fc.Arbitrary<ValidatedCandidate> = fc.record({
  candidate: fc.record({
    sourceUrl: fc.webUrl(),
    sourceName: fc.string(),
    excerpt: fc.option(fc.string(), { nil: undefined }),
    sourceTier: fc.constantFrom(...SOURCE_TIERS),
    isFactCheck: fc.boolean(),
    fromVariant: fc.constantFrom(...VARIANT_KINDS),
    retrievalRank: fc.nat(),
  }) satisfies fc.Arbitrary<Candidate>,
  matchType: fc.constantFrom(...MATCH_TYPES),
  // boundary confidences 0 and 1 weighted in alongside arbitrary in-range values
  matchConfidence: fc.oneof(
    fc.constant(0),
    fc.constant(1),
    fc.float({ min: 0, max: 1, noNaN: true }),
  ),
  selectedAsEvidence: fc.boolean(),
});

// Assign a unique sourceUrl per candidate so routed regions can be correlated back to
// their input unambiguously (fc.webUrl can otherwise collide across a generated array).
function withUniqueUrls(list: ValidatedCandidate[]): ValidatedCandidate[] {
  return list.map((vc, i) => ({
    ...vc,
    candidate: { ...vc.candidate, sourceUrl: `https://src.test/${i}` },
  }));
}

test('Property 8: routing honors match type and the excluded-tier hard gate', () => {
  fc.assert(
    // Cover both single-query retrieval (one candidate) and full-pack retrieval (many).
    fc.property(fc.array(validatedArb, { minLength: 0, maxLength: 30 }), (rawList) => {
      const list = withUniqueUrls(rawList);
      const result = routeCandidates(list);

      const citedUrls = new Set(result.citations.map((c) => c.sourceUrl));
      const usefulUrls = new Set(result.usefulContext.map((c) => c.sourceUrl));
      const cardUrls = new Set(result.contextCards.map((c) => c.sourceUrl));

      // No duplicate citations: each ledger-eligible candidate yields exactly one.
      assert.equal(citedUrls.size, result.citations.length, 'duplicate citations produced');

      // The if-and-only-if gate, checked per input candidate.
      for (const vc of list) {
        const url = vc.candidate.sourceUrl;
        const matchPermits =
          vc.matchType === 'same_claim' || vc.matchType === 'contradictory_but_relevant';
        const eligible = matchPermits && vc.candidate.sourceTier !== 'excluded';

        // isLedgerEligible is the single source of truth for the gate.
        assert.equal(isLedgerEligible(vc), eligible, `gate disagreement for ${vc.matchType}`);

        // IFF: cited exactly when eligible.
        assert.equal(
          citedUrls.has(url),
          eligible,
          `candidate (${vc.matchType}, ${vc.candidate.sourceTier}, conf=${vc.matchConfidence}) ` +
            `${eligible ? 'should' : 'should NOT'} be a citation`,
        );

        // Excluded tier is a hard gate: never a citation regardless of Match_Type/Confidence.
        if (vc.candidate.sourceTier === 'excluded') {
          assert.ok(!citedUrls.has(url), 'excluded-tier candidate leaked into the ledger');
        }

        // contradictory_but_relevant, when cited, is recorded with supports === false.
        if (vc.matchType === 'contradictory_but_relevant' && eligible) {
          const cite = result.citations.find((c) => c.sourceUrl === url);
          assert.ok(cite, 'expected a citation for an eligible contradictory candidate');
          assert.equal(cite!.supports, false, 'contradictory citation must record supports === false');
        }
        // same_claim, when cited, supports the claim.
        if (vc.matchType === 'same_claim' && eligible) {
          const cite = result.citations.find((c) => c.sourceUrl === url);
          assert.equal(cite!.supports, true, 'same_claim citation must record supports === true');
        }

        // same_topic_different_claim → Useful_Context ONLY (never ledger, never card).
        if (vc.matchType === 'same_topic_different_claim') {
          assert.ok(usefulUrls.has(url), 'same_topic candidate missing from Useful_Context');
          assert.ok(!citedUrls.has(url), 'same_topic candidate leaked into the ledger');
          assert.ok(!cardUrls.has(url), 'same_topic candidate leaked into a Context_Card');
        }

        // background_context → Context_Card ONLY.
        if (vc.matchType === 'background_context') {
          assert.ok(cardUrls.has(url), 'background_context candidate missing from Context_Card');
          assert.ok(!citedUrls.has(url), 'background_context candidate leaked into the ledger');
          assert.ok(!usefulUrls.has(url), 'background_context candidate leaked into Useful_Context');
        }

        // irrelevant → appears nowhere.
        if (vc.matchType === 'irrelevant') {
          assert.ok(
            !citedUrls.has(url) && !usefulUrls.has(url) && !cardUrls.has(url),
            'irrelevant candidate should appear in no region',
          );
        }
      }

      // routed mirrors the inputs with selectedAsEvidence recomputed by the gate.
      assert.equal(result.routed.length, list.length, 'routed must mirror every input');
      for (const r of result.routed) {
        assert.equal(
          r.selectedAsEvidence,
          isLedgerEligible(r),
          'routed.selectedAsEvidence must equal the gate verdict',
        );
      }
    }),
    { numRuns: 100 },
  );
});
