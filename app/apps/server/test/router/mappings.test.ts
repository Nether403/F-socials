// Feature: claim-verification-router, Property 11: Outcome-to-strength and outcome-to-vocabulary mappings are deterministic and total
// For ANY Evidence_Outcome, outcomeToStrength is total (returns a member of {strong, moderate, weak, none}),
// single-valued, and stable across repeated calls, with no_sufficient_evidence and not_fact_checkable both
// mapping to none; and for ANY (Evidence_Outcome, hasSupporting, hasContradicting), outcomeToVocab is total
// (returns a member of {supported, mixed, weak, insufficient}), single-valued, and stable across repeated
// calls, with the mixed override applying exactly to matched_* outcomes carrying both a supporting and a
// contradicting citation.
// Validates: Requirements 4.7, 4.8, 4.9

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { outcomeToStrength, outcomeToVocab } from '../../src/router/outcome';
import type { EvidenceOutcome, EvidenceStrength, PrototypeVocab } from '../../src/types';

const OUTCOMES: readonly EvidenceOutcome[] = [
  'matched_fact_check',
  'matched_primary_source',
  'matched_institutional_source',
  'relevant_context_only',
  'no_sufficient_evidence',
  'not_fact_checkable',
];

const STRENGTHS: readonly EvidenceStrength[] = ['strong', 'moderate', 'weak', 'none'];
const VOCABS: readonly PrototypeVocab[] = ['supported', 'mixed', 'weak', 'insufficient'];

const MATCHED: ReadonlySet<EvidenceOutcome> = new Set<EvidenceOutcome>([
  'matched_fact_check',
  'matched_primary_source',
  'matched_institutional_source',
]);

const outcomeArb: fc.Arbitrary<EvidenceOutcome> = fc.constantFrom(...OUTCOMES);

test('Property 11a: outcomeToStrength is total, single-valued, and stable', () => {
  fc.assert(
    fc.property(outcomeArb, (outcome) => {
      const first = outcomeToStrength(outcome);

      // Total: the result is always a member of the Evidence_Strength vocabulary (Req 4.7).
      assert.ok(STRENGTHS.includes(first), `strength ${first} is not a member of the vocabulary`);

      // Single-valued + stable: repeated calls return the identical value (Req 4.7).
      for (let i = 0; i < 5; i++) {
        assert.equal(outcomeToStrength(outcome), first, 'outcomeToStrength must be stable across calls');
      }

      // no_sufficient_evidence and not_fact_checkable both map to none (Req 4.8).
      if (outcome === 'no_sufficient_evidence' || outcome === 'not_fact_checkable') {
        assert.equal(first, 'none', `${outcome} must map to strength none`);
      }

      // The construction that keeps the Invariant_Gate honest: a non-none strength
      // is produced by exactly the matched_* outcomes (Req 4.8, 9.3).
      if (first !== 'none') {
        assert.ok(MATCHED.has(outcome), `non-none strength produced by non-matched outcome ${outcome}`);
      }
    }),
    { numRuns: 100 },
  );
});

test('Property 11b: outcomeToVocab is total, single-valued, stable, with the matched_* mixed override', () => {
  fc.assert(
    fc.property(outcomeArb, fc.boolean(), fc.boolean(), (outcome, hasSupporting, hasContradicting) => {
      const first = outcomeToVocab(outcome, hasSupporting, hasContradicting);

      // Total: the result is always a member of the prototype vocabulary (Req 4.9).
      assert.ok(VOCABS.includes(first), `vocab ${first} is not a member of the vocabulary`);

      // Single-valued + stable: repeated calls with the same inputs return the same value (Req 4.9).
      for (let i = 0; i < 5; i++) {
        assert.equal(
          outcomeToVocab(outcome, hasSupporting, hasContradicting),
          first,
          'outcomeToVocab must be stable across calls',
        );
      }

      // The mixed override applies exactly to a matched_* outcome whose ledger carries
      // BOTH a supporting and a contradicting citation; nowhere else (Req 4.9).
      if (MATCHED.has(outcome) && hasSupporting && hasContradicting) {
        assert.equal(first, 'mixed', 'matched_* with both supporting and contradicting must be mixed');
      } else {
        assert.notEqual(first, 'mixed', `mixed produced outside the override for ${outcome}`);
      }
    }),
    { numRuns: 100 },
  );
});
