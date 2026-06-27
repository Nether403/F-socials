// Feature: claim-verification-router, Property 6: Validator output is well-formed
// For ANY Candidate, the CandidateValidator assigns exactly one Match_Type from the
// five-member set and a Match_Confidence in the inclusive range 0 to 1.
// Validates: Requirements 3.1

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { seededValidator } from '../../src/router/validate';
import { verifyClaim, type VerifyDeps } from '../../src/router/index';
import type {
  Candidate,
  MatchType,
  QueryVariant,
  SourceTier,
  QueryVariantKind,
} from '../../src/types';
import type { CandidateValidator, ClaimNormalizer } from '../../src/providers/types';

const MATCH_TYPE_SET: ReadonlySet<MatchType> = new Set<MatchType>([
  'same_claim',
  'same_topic_different_claim',
  'background_context',
  'contradictory_but_relevant',
  'irrelevant',
]);

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

// Arbitrary Candidate generator. Covers optional excerpt (present/absent), all
// source tiers, both provider origins, all variant kinds, and arbitrary ranks so
// the validator's total contract is exercised across the whole input space.
const candidateArb: fc.Arbitrary<Candidate> = fc.record({
  sourceUrl: fc.webUrl(),
  sourceName: fc.string(),
  excerpt: fc.option(fc.string(), { nil: undefined }),
  sourceTier: fc.constantFrom(...SOURCE_TIERS),
  isFactCheck: fc.boolean(),
  fromVariant: fc.constantFrom(...VARIANT_KINDS),
  retrievalRank: fc.nat(),
});

test('Property 6: validator output is well-formed for any candidate', async () => {
  await fc.assert(
    // For any original claim string and any Candidate, the seeded validator returns
    // exactly one valid Match_Type and a Match_Confidence within [0,1], every time,
    // with no throw. Uses the deterministic seeded mock validator.
    fc.asyncProperty(fc.string(), candidateArb, async (originalClaim, candidate) => {
      const result = await seededValidator.validate(originalClaim, candidate);

      assert.ok(
        MATCH_TYPE_SET.has(result.matchType),
        `expected exactly one valid Match_Type, got ${String(result.matchType)}`,
      );
      assert.ok(
        Number.isFinite(result.matchConfidence),
        `expected a finite Match_Confidence, got ${String(result.matchConfidence)}`,
      );
      assert.ok(
        result.matchConfidence >= 0 && result.matchConfidence <= 1,
        `expected Match_Confidence in [0,1], got ${result.matchConfidence}`,
      );
    }),
    { numRuns: 100 },
  );
});

// Feature: claim-verification-router, Property 7: Candidates are validated against the original claim
// For ANY claim and ANY Candidate surfaced by ANY Query_Variant, the string the router
// passes to the CandidateValidator is the Original_Claim, never the Query_Variant text
// that surfaced the candidate.
// Validates: Requirements 3.2

// A distinctive marker that survives query-pack compression (alphabetic, no
// stopwords/punctuation). Prefixing the Canonical_Claim with it guarantees every
// generated Query_Variant text differs from the Original_Claim, so the assertion
// "validator never saw a variant text" is meaningful for any generated claim.
const CANON_MARKER = 'canonicalmarkerzqx';

// A stub normalizer that forces `checkable` so retrieval ALWAYS runs (the property is
// about what string reaches the validator during retrieval/validation). Its
// Canonical_Claim is deliberately distinct from the Original_Claim.
const checkableNormalizer: ClaimNormalizer = {
  async normalize(originalClaim: string) {
    return {
      canonicalClaim: `${CANON_MARKER} ${originalClaim}`,
      claimType: 'factual_event',
      factCheckability: 'checkable',
    };
  },
};

// Build N candidates with varied url/excerpt so the seeded validator spreads them
// across Match_Types; the property does not depend on which Match_Type is returned.
function candidatesForVariant(variant: QueryVariant, n: number): Candidate[] {
  const tier: SourceTier = 'tier2_institutional';
  return Array.from({ length: n }, (_, i) => ({
    sourceUrl: `https://www.example.org/${encodeURIComponent(variant.kind)}/${i}`,
    sourceName: `Source ${variant.kind} ${i}`,
    excerpt: `excerpt ${variant.kind} ${i}`,
    sourceTier: tier,
    isFactCheck: false,
    fromVariant: variant.kind as QueryVariantKind,
    retrievalRank: i,
  }));
}

test('Property 7: candidates are validated against the original claim, never a variant', async () => {
  await fc.assert(
    fc.asyncProperty(
      // Any original claim, and 1..3 candidates per variant so multiple validate()
      // calls are exercised per run.
      fc.string(),
      fc.integer({ min: 1, max: 3 }),
      async (originalClaim, perVariant) => {
        const recordedOriginals: string[] = [];
        const seenVariantTexts = new Set<string>();

        // Spy validator: records every originalClaim arg it receives, then delegates
        // to the real seeded validator for a well-formed result.
        const spyValidator: CandidateValidator = {
          async validate(claim, candidate) {
            recordedOriginals.push(claim);
            return seededValidator.validate(claim, candidate);
          },
        };

        // retrieve records the variant text it was asked for and returns candidates.
        const deps: VerifyDeps = {
          normalizer: checkableNormalizer,
          validator: spyValidator,
          retrieve: async (variant) => {
            seenVariantTexts.add(variant.text);
            return candidatesForVariant(variant, perVariant);
          },
          classifyTier: () => 'tier2_institutional',
        };

        await verifyClaim(originalClaim, deps);

        // The claim is checkable, so a Query_Pack ran and produced candidates: at
        // least one validate() call must have happened.
        assert.ok(
          recordedOriginals.length >= 1,
          'expected the validator to be called for surfaced candidates',
        );

        // Core of Property 7: every string handed to the validator is EXACTLY the
        // Original_Claim, and never the text of any Query_Variant that surfaced a
        // candidate (Req 3.2).
        for (const recorded of recordedOriginals) {
          assert.equal(
            recorded,
            originalClaim,
            'validator must receive the Original_Claim, not a variant',
          );
          assert.ok(
            !seenVariantTexts.has(recorded),
            'validator must never receive a Query_Variant text',
          );
        }

        // Sanity: the variants really are distinct from the original (otherwise the
        // "never a variant" assertion would be vacuous).
        assert.ok(
          !seenVariantTexts.has(originalClaim),
          'expected every Query_Variant text to differ from the Original_Claim',
        );
      },
    ),
    { numRuns: 100 },
  );
});
