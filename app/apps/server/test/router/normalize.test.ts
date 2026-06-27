// Feature: claim-verification-router, Property 1: Normalizer output is well-formed
// For ANY claim string, the ClaimNormalizer output assigns exactly one ClaimType
// from the seven-member set and exactly one FactCheckability value from
// {checkable, not_fact_checkable}.
// Validates: Requirements 1.1, 1.2

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { seededNormalizer } from '../../src/router/normalize';
import type { ClaimType, FactCheckability } from '../../src/types';

const CLAIM_TYPE_SET: ReadonlySet<ClaimType> = new Set<ClaimType>([
  'factual_event',
  'statistical',
  'causal',
  'quote_paraphrase',
  'prediction',
  'normative_opinion',
  'implied_rhetorical',
]);

const FACT_CHECKABILITY_SET: ReadonlySet<FactCheckability> = new Set<FactCheckability>([
  'checkable',
  'not_fact_checkable',
]);

test('Property 1: normalizer output is well-formed for any claim string', async () => {
  await fc.assert(
    // Arbitrary strings — garbage, sentences, questions, and unicode — all exercise
    // the same total contract: exactly one ClaimType, exactly one FactCheckability,
    // every time, with no throw. Uses the deterministic seeded mock normalizer.
    fc.asyncProperty(fc.string(), async (claim) => {
      const result = await seededNormalizer.normalize(claim);

      assert.ok(
        CLAIM_TYPE_SET.has(result.claimType),
        `expected exactly one valid ClaimType, got ${String(result.claimType)}`,
      );
      assert.ok(
        FACT_CHECKABILITY_SET.has(result.factCheckability),
        `expected exactly one valid FactCheckability, got ${String(result.factCheckability)}`,
      );
    }),
    { numRuns: 100 },
  );
});

// Feature: claim-verification-router, Property 2: Claim type determines fact-checkability
// For ANY normalized claim, if its ClaimType is normative_opinion then its
// FactCheckability is not_fact_checkable, and if its ClaimType is factual_event then
// its FactCheckability is checkable (never not_fact_checkable).
// Validates: Requirements 1.3, 1.4

test('Property 2: claim type determines fact-checkability for any claim string', async () => {
  await fc.assert(
    // Implication over arbitrary claim strings: whatever ClaimType the deterministic
    // seeded normalizer lands on, the two type-driven constraints must hold on its
    // output. normative_opinion forces not_fact_checkable (Req 1.3); factual_event
    // forces checkable and never not_fact_checkable (Req 1.4). Other types are
    // unconstrained here. Strings include opinion/factual phrasings via fc.string
    // plus a few seeded constants so both branches are exercised.
    fc.asyncProperty(
      fc.oneof(
        fc.string(),
        fc.constantFrom(
          'I think pineapple is the best pizza topping',
          'pineapple deserves better than this',
          'The Berlin Wall fell in 1989',
          'Paris is the capital of France',
        ),
      ),
      async (claim) => {
        const result = await seededNormalizer.normalize(claim);

        if (result.claimType === 'normative_opinion') {
          assert.equal(
            result.factCheckability,
            'not_fact_checkable',
            `normative_opinion must be not_fact_checkable, got ${result.factCheckability}`,
          );
        }

        if (result.claimType === 'factual_event') {
          assert.equal(
            result.factCheckability,
            'checkable',
            `factual_event must be checkable, got ${result.factCheckability}`,
          );
          assert.notEqual(
            result.factCheckability,
            'not_fact_checkable',
            'factual_event must never be not_fact_checkable',
          );
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ── Task 2.4: example/unit tests for rhetorical-claim canonicalization ──────────
// These are deterministic example tests (not property tests) over the seeded
// normalizer. They pin the two rhetorical branches the requirements name:
//   - an implied_rhetorical claim that CAN be turned into an explicit checkable
//     hypothesis becomes `checkable` with a Canonical_Claim that states that
//     hypothesis (Req 1.6, 1.8), and
//   - an implied_rhetorical claim that CANNOT be transformed becomes
//     `not_fact_checkable` (Req 1.7), so the router skips verification.
// Validates: Requirements 1.6, 1.8

test('implied_rhetorical claim becomes an explicit checkable hypothesis (Req 1.6, 1.8)', async () => {
  // A rhetorical question with recoverable propositional content: stripping the
  // interrogative lead-in ("Isn't") leaves ">= 3" alphabetic, non-opinion words, so
  // the normalizer states it as an explicit, checkable declarative hypothesis.
  const result = await seededNormalizer.normalize(
    "Isn't the national debt growing every single year?",
  );

  assert.equal(result.claimType, 'implied_rhetorical');
  // Req 1.6: an explicit, checkable hypothesis is produced before any search.
  assert.equal(result.factCheckability, 'checkable');
  // Req 1.8: the Canonical_Claim is an explicit declarative restatement derived from
  // the original — no longer a question, stated as a hypothesis ending in a period.
  assert.ok(result.canonicalClaim.length > 0, 'canonical claim must be non-empty');
  assert.ok(
    !result.canonicalClaim.includes('?'),
    `canonical claim must not remain a question, got ${result.canonicalClaim}`,
  );
  assert.ok(
    result.canonicalClaim.endsWith('.'),
    `canonical claim must be a declarative statement, got ${result.canonicalClaim}`,
  );
  assert.match(result.canonicalClaim, /national debt/i);
});

test('un-transformable rhetorical claim (too little content) becomes not_fact_checkable (Req 1.7)', async () => {
  // "Really?" reduces to nothing once the interrogative/filler lead-in is stripped,
  // so no checkable proposition can be recovered.
  const result = await seededNormalizer.normalize('Really?');

  assert.equal(result.claimType, 'implied_rhetorical');
  assert.equal(result.factCheckability, 'not_fact_checkable');
});

test('un-transformable rhetorical claim (pure value judgment) becomes not_fact_checkable (Req 1.7)', async () => {
  // A rhetorical question whose recovered core is a value judgment ("best") is not a
  // checkable hypothesis, so the normalizer honestly marks it not_fact_checkable
  // rather than dressing an opinion up as something searchable.
  const result = await seededNormalizer.normalize(
    "Isn't pineapple the best pizza topping?",
  );

  assert.equal(result.claimType, 'implied_rhetorical');
  assert.equal(result.factCheckability, 'not_fact_checkable');
});
