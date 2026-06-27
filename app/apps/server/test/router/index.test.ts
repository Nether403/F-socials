// Feature: claim-verification-router, Property 3: A not-fact-checkable claim is never searched
// For ANY claim whose FactCheckability is not_fact_checkable (including a rhetorical
// claim the normalizer could not turn into a checkable hypothesis), verifyClaim
// generates no Query_Pack and makes ZERO Provider_Chain (retrieve) calls for that
// claim, and the Audit_Record's queryPack and candidates are both empty.
// Validates: Requirements 1.5, 1.7

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { verifyClaim, type VerifyDeps } from '../../src/router/index';
import { seededNormalizer } from '../../src/router/normalize';
import { seededValidator } from '../../src/router/validate';
import type { Candidate, ClaimType, FactCheckability } from '../../src/types';
import type { ClaimNormalizer } from '../../src/providers/types';

// A retrieve dep that counts every call. If the router honors triage, a
// not_fact_checkable claim must never reach this — the count stays at 0. Returning a
// candidate (rather than []) makes the test strict: a leaked call would also leak
// evidence into the audit, so both assertions guard the short-circuit.
function countingRetrieve(): { retrieve: VerifyDeps['retrieve']; calls: () => number } {
  let calls = 0;
  const candidate: Candidate = {
    sourceUrl: 'https://www.example.org/leak',
    sourceName: 'Leak',
    excerpt: 'should never be retrieved',
    sourceTier: 'tier2_institutional',
    isFactCheck: false,
    fromVariant: 'exact_normalized',
    retrievalRank: 0,
  };
  return {
    retrieve: async () => {
      calls += 1;
      return [candidate];
    },
    calls: () => calls,
  };
}

// A normalizer stub that forces not_fact_checkable for ANY claim, regardless of the
// seeded heuristic — this isolates Property 3 to the triage short-circuit (Req 1.5)
// and also models the Req 1.7 case (an un-transformable rhetorical claim) and the
// normalizer-failure default, all of which surface as not_fact_checkable.
const notCheckableNormalizer: ClaimNormalizer = {
  async normalize(originalClaim: string) {
    return {
      canonicalClaim: originalClaim,
      claimType: 'implied_rhetorical' as ClaimType,
      factCheckability: 'not_fact_checkable' as FactCheckability,
    };
  },
};

function depsWith(normalizer: ClaimNormalizer): { deps: VerifyDeps; calls: () => number } {
  const { retrieve, calls } = countingRetrieve();
  return {
    deps: {
      normalizer,
      validator: seededValidator,
      retrieve,
      classifyTier: () => 'tier2_institutional',
    },
    calls,
  };
}

test('Property 3: a not_fact_checkable claim is never searched (stub normalizer, any claim)', async () => {
  await fc.assert(
    // For ANY claim string, when the normalizer reports not_fact_checkable the router
    // must short-circuit: zero retrieve calls, an empty Query_Pack, empty candidates,
    // a not_fact_checkable outcome, strength 'none', and zero ledger citations.
    fc.asyncProperty(fc.string(), async (claim) => {
      const { deps, calls } = depsWith(notCheckableNormalizer);
      const result = await verifyClaim(claim, deps);

      assert.equal(calls(), 0, 'retrieve (Provider_Chain) must never be called'); // Req 1.5
      assert.equal(result.audit.queryPack.length, 0, 'Query_Pack must be empty'); // Req 1.5
      assert.equal(result.audit.candidates.length, 0, 'candidates must be empty');
      assert.equal(result.evidenceOutcome, 'not_fact_checkable');
      assert.equal(result.evidenceStrength, 'none');
      assert.equal(result.citations.length, 0);
    }),
    { numRuns: 100 },
  );
});

test('Property 3: opinion claims via the seeded normalizer are never searched', async () => {
  // Same invariant exercised end-to-end through the real seeded normalizer, which
  // classifies opinions as normative_opinion → not_fact_checkable (Req 1.3) and
  // content-less rhetorical questions as not_fact_checkable (Req 1.7). The router
  // must still make zero retrieve calls and produce an empty audit.
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(
        'I think pineapple is the best pizza topping',
        'This movie is absolutely terrible',
        'We believe taxes are far too high',
        'In my opinion the album is overrated',
        'Really?',
        "Isn't pineapple the best pizza topping?",
      ),
      async (claim) => {
        // Guard the precondition: only assert on claims the seeded normalizer marks
        // not_fact_checkable, so this stays a Property 3 test and never fails on a
        // string that happens to be checkable.
        const normalized = await seededNormalizer.normalize(claim);
        fc.pre(normalized.factCheckability === 'not_fact_checkable');

        const { deps, calls } = depsWith(seededNormalizer);
        const result = await verifyClaim(claim, deps);

        assert.equal(calls(), 0, 'retrieve (Provider_Chain) must never be called'); // Req 1.5, 1.7
        assert.equal(result.audit.queryPack.length, 0);
        assert.equal(result.audit.candidates.length, 0);
        assert.equal(result.evidenceOutcome, 'not_fact_checkable');
        assert.equal(result.evidenceStrength, 'none');
        assert.equal(result.citations.length, 0);
      },
    ),
    { numRuns: 100 },
  );
});
