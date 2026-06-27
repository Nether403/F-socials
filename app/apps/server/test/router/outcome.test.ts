// Feature: claim-verification-router, Property 10: Exactly one Evidence_Outcome is assigned per the assignment rules
// For ANY processed claim, the router assigns exactly one Evidence_Outcome from the six-member set such that:
// a not_fact_checkable claim with no ledger-eligible candidate is not_fact_checkable; a claim with at least one
// ledger-eligible candidate (same_claim/contradictory_but_relevant, tier !== excluded) is a matched_* outcome
// (overriding a prior not_fact_checkable); a checkable claim with only routed context and no ledger evidence is
// relevant_context_only; and a checkable claim with no ledger-eligible candidate and no routed context is
// no_sufficient_evidence.
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { routeCandidates, assignEvidenceOutcome, isLedgerEligible } from '../../src/router/outcome';
import type {
  Candidate,
  EvidenceOutcome,
  FactCheckability,
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

const OUTCOMES: readonly EvidenceOutcome[] = [
  'matched_fact_check',
  'matched_primary_source',
  'matched_institutional_source',
  'relevant_context_only',
  'no_sufficient_evidence',
  'not_fact_checkable',
];

const MATCHED: ReadonlySet<EvidenceOutcome> = new Set<EvidenceOutcome>([
  'matched_fact_check',
  'matched_primary_source',
  'matched_institutional_source',
]);

// Drives the whole assignment input space: all five Match_Types, all four
// Source_Tiers (including `excluded`), both provider origins, and boundary
// confidences 0 and 1. selectedAsEvidence is generated arbitrarily — the router
// recomputes the gate inside routeCandidates and must not trust the incoming value.
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
  matchConfidence: fc.oneof(
    fc.constant(0),
    fc.constant(1),
    fc.float({ min: 0, max: 1, noNaN: true }),
  ),
  selectedAsEvidence: fc.boolean(),
});

const factCheckabilityArb: fc.Arbitrary<FactCheckability> = fc.constantFrom(
  'checkable',
  'not_fact_checkable',
);

test('Property 10: exactly one Evidence_Outcome is assigned per the assignment rules', () => {
  fc.assert(
    fc.property(
      fc.array(validatedArb, { minLength: 0, maxLength: 30 }),
      factCheckabilityArb,
      (validated, factCheckability) => {
        const routing = routeCandidates(validated);
        const outcome = assignEvidenceOutcome(factCheckability, routing);

        // Exactly one member of the six-member set.
        assert.ok(OUTCOMES.includes(outcome), `outcome ${outcome} is not a member of the set`);

        // Independently derive the ledger-eligible set from the gate (not from routing.routed)
        // so the test does not simply mirror the implementation's bookkeeping.
        const ledgerEligible = validated.filter(isLedgerEligible);
        const hasLedger = ledgerEligible.length > 0;
        const hasContext = routing.usefulContext.length > 0 || routing.contextCards.length > 0;

        if (hasLedger) {
          // A claim with >= 1 ledger-eligible candidate is a matched_* outcome,
          // overriding a prior not_fact_checkable regardless of fact-checkability.
          assert.ok(
            MATCHED.has(outcome),
            `expected a matched_* outcome with ledger evidence, got ${outcome}`,
          );

          // Provenance order: fact_check > tier1_primary > institutional.
          const anyFactCheck = ledgerEligible.some((vc) => vc.candidate.isFactCheck);
          const anyTier1 = ledgerEligible.some((vc) => vc.candidate.sourceTier === 'tier1_primary');
          if (anyFactCheck) {
            assert.equal(outcome, 'matched_fact_check', 'a fact-check source must win provenance');
          } else if (anyTier1) {
            assert.equal(outcome, 'matched_primary_source', 'tier1_primary must win over institutional');
          } else {
            assert.equal(
              outcome,
              'matched_institutional_source',
              'no fact-check / tier1 ledger evidence must map to institutional',
            );
          }
        } else if (factCheckability === 'not_fact_checkable') {
          // not checkable + no ledger-eligible candidate → not_fact_checkable.
          assert.equal(outcome, 'not_fact_checkable', 'not-checkable + no ledger must be not_fact_checkable');
        } else if (hasContext) {
          // checkable + only routed context, no ledger evidence → relevant_context_only.
          assert.equal(outcome, 'relevant_context_only', 'checkable + context-only must be relevant_context_only');
        } else {
          // checkable + no ledger-eligible candidate + no routed context → no_sufficient_evidence.
          assert.equal(outcome, 'no_sufficient_evidence', 'checkable + nothing must be no_sufficient_evidence');
        }

        // A matched_* outcome is produced only when ledger evidence actually exists.
        if (MATCHED.has(outcome)) {
          assert.ok(hasLedger, `matched_* outcome ${outcome} produced without ledger evidence`);
        }
      },
    ),
    { numRuns: 100 },
  );
});
