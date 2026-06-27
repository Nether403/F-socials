// Feature: claim-verification-router, Property 13: The Audit_Record is complete for every claim
// For any processed claim, the router emits exactly one Audit_Record that records the
// distinct Original_Claim and Canonical_Claim, the Claim_Type, the Fact_Checkability,
// the Query_Pack, the raw Candidate results, the final Evidence_Outcome, and — for each
// candidate — whether it was selected as evidence, its Match_Type, its Match_Confidence,
// its Source_Tier, and its retrieval rank as four distinct signals (never collapsed into
// a single score); and when the claim is not_fact_checkable the recorded Query_Pack and
// Candidate results are both empty.
// Validates: Requirements 1.9, 4.6, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildAuditRecord, type AuditInput } from '../../src/router/audit';
import type {
  ClaimType,
  EvidenceOutcome,
  EvidenceStrength,
  FactCheckability,
  MatchType,
  PrototypeVocab,
  QueryVariant,
  QueryVariantKind,
  SourceTier,
  ValidatedCandidate,
} from '../../src/types';

const CLAIM_TYPES: readonly ClaimType[] = [
  'factual_event',
  'statistical',
  'causal',
  'quote_paraphrase',
  'prediction',
  'normative_opinion',
  'implied_rhetorical',
];

const FACT_CHECKABILITY: readonly FactCheckability[] = ['checkable', 'not_fact_checkable'];

const VARIANT_KINDS: readonly QueryVariantKind[] = [
  'exact_normalized',
  'compressed_entity_predicate',
  'fact_check_style',
  'counterclaim_negated',
  'source_language',
  'english',
];

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

const EVIDENCE_OUTCOMES: readonly EvidenceOutcome[] = [
  'matched_fact_check',
  'matched_primary_source',
  'matched_institutional_source',
  'relevant_context_only',
  'no_sufficient_evidence',
  'not_fact_checkable',
];

const EVIDENCE_STRENGTHS: readonly EvidenceStrength[] = ['strong', 'moderate', 'weak', 'none'];

const PROTOTYPE_VOCABS: readonly PrototypeVocab[] = ['supported', 'mixed', 'weak', 'insufficient'];

const queryVariantArb: fc.Arbitrary<QueryVariant> = fc.record({
  text: fc.string({ minLength: 1, maxLength: 80 }),
  kind: fc.constantFrom(...VARIANT_KINDS),
});

// Validated candidates carry the five per-candidate signals the audit must keep
// distinct: selected-as-evidence, Match_Type, Match_Confidence (on the validation),
// plus Source_Tier and retrieval rank (on the inner Candidate). Match_Confidence is
// generated across the full [0,1] range including the 0 and 1 boundaries.
const validatedCandidateArb: fc.Arbitrary<ValidatedCandidate> = fc.record({
  candidate: fc.record({
    sourceUrl: fc.webUrl(),
    sourceName: fc.string(),
    excerpt: fc.option(fc.string(), { nil: undefined }),
    sourceTier: fc.constantFrom(...SOURCE_TIERS),
    isFactCheck: fc.boolean(),
    fromVariant: fc.constantFrom(...VARIANT_KINDS),
    retrievalRank: fc.nat(),
  }),
  matchType: fc.constantFrom(...MATCH_TYPES),
  matchConfidence: fc.double({ min: 0, max: 1, noNaN: true }),
  selectedAsEvidence: fc.boolean(),
});

// A full AuditInput. originalClaim and canonicalClaim are generated as a distinct
// pair so Property 13's "records the distinct Original_Claim and Canonical_Claim"
// is actually exercised (Req 1.9). claimId/createdAt are left to the builder's
// defaults on some runs and supplied on others.
const auditInputArb: fc.Arbitrary<AuditInput> = fc
  .record({
    claimId: fc.option(fc.uuid(), { nil: undefined }),
    distinctClaims: fc
      .tuple(fc.string({ minLength: 1, maxLength: 120 }), fc.string({ minLength: 1, maxLength: 120 }))
      .filter(([a, b]) => a !== b),
    claimType: fc.constantFrom(...CLAIM_TYPES),
    factCheckability: fc.constantFrom(...FACT_CHECKABILITY),
    queryPack: fc.array(queryVariantArb, { maxLength: 6 }),
    candidates: fc.array(validatedCandidateArb, { maxLength: 8 }),
    evidenceOutcome: fc.constantFrom(...EVIDENCE_OUTCOMES),
    evidenceStrength: fc.constantFrom(...EVIDENCE_STRENGTHS),
    prototypeVocab: fc.constantFrom(...PROTOTYPE_VOCABS),
    createdAt: fc.option(fc.date({ noInvalidDate: true }).map((d) => d.toISOString()), { nil: undefined }),
  })
  .map((r) => ({
    claimId: r.claimId,
    originalClaim: r.distinctClaims[0],
    canonicalClaim: r.distinctClaims[1],
    claimType: r.claimType,
    factCheckability: r.factCheckability,
    queryPack: r.queryPack,
    candidates: r.candidates,
    evidenceOutcome: r.evidenceOutcome,
    evidenceStrength: r.evidenceStrength,
    prototypeVocab: r.prototypeVocab,
    createdAt: r.createdAt,
  }));

test('Property 13: the Audit_Record is complete for every claim', () => {
  fc.assert(
    fc.property(auditInputArb, (input) => {
      const record = buildAuditRecord(input);

      // Exactly one record, with a non-empty claim id and a valid ISO createdAt
      // (Req 6.1).
      assert.ok(record, 'expected exactly one Audit_Record');
      assert.equal(typeof record.claimId, 'string');
      assert.ok(record.claimId.length > 0, 'Audit_Record must carry a claim id');
      assert.ok(!Number.isNaN(Date.parse(record.createdAt)), 'createdAt must be a valid ISO instant');

      // Req 1.9 / 6.2: distinct Original_Claim and Canonical_Claim are both recorded,
      // on separate fields, verbatim.
      assert.equal(record.originalClaim, input.originalClaim);
      assert.equal(record.canonicalClaim, input.canonicalClaim);
      assert.notEqual(record.originalClaim, record.canonicalClaim);

      // Req 6.2: Claim_Type and Fact_Checkability recorded.
      assert.equal(record.claimType, input.claimType);
      assert.equal(record.factCheckability, input.factCheckability);

      // Req 4.6 / 6.5: the final Evidence_Outcome (and its derived strength/vocab) recorded.
      assert.equal(record.evidenceOutcome, input.evidenceOutcome);
      assert.equal(record.evidenceStrength, input.evidenceStrength);
      assert.equal(record.prototypeVocab, input.prototypeVocab);

      if (record.factCheckability === 'not_fact_checkable') {
        // Req 6.6: a not-searched claim records an empty Query_Pack and empty
        // Candidate results — the honest "not searched" record — regardless of what
        // the caller passed in.
        assert.equal(record.queryPack.length, 0, 'not_fact_checkable must record an empty Query_Pack');
        assert.equal(record.candidates.length, 0, 'not_fact_checkable must record empty Candidate results');
      } else {
        // Req 6.2 / 6.3: the Query_Pack used and the raw Candidate results are recorded.
        assert.deepEqual(record.queryPack, input.queryPack, 'Query_Pack must be recorded for a searched claim');
        assert.equal(
          record.candidates.length,
          input.candidates.length,
          'every Candidate result must be recorded',
        );

        // Req 5.4 / 6.4: for each candidate, the five signals are recorded and kept
        // DISTINCT — never collapsed into a single combined score. We assert each
        // signal survives independently and equals its input value.
        record.candidates.forEach((vc, i) => {
          const src = input.candidates[i]!;
          assert.equal(vc.selectedAsEvidence, src.selectedAsEvidence, 'selected-as-evidence signal lost');
          assert.equal(vc.matchType, src.matchType, 'Match_Type signal lost');
          assert.equal(vc.matchConfidence, src.matchConfidence, 'Match_Confidence signal lost');
          assert.equal(vc.candidate.sourceTier, src.candidate.sourceTier, 'Source_Tier signal lost');
          assert.equal(vc.candidate.retrievalRank, src.candidate.retrievalRank, 'retrieval rank signal lost');
          // No single collapsed "score" field exists on the recorded candidate.
          assert.ok(!('score' in (vc as unknown as Record<string, unknown>)), 'signals must not collapse into a score');
        });
      }

      // The builder must not alias the caller's arrays (mutating the record must not
      // reach back into the input).
      assert.notEqual(record.queryPack, input.queryPack);
      assert.notEqual(record.candidates, input.candidates);
    }),
    { numRuns: 100 },
  );
});
