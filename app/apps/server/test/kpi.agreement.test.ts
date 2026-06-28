// Feature: observability-instrumentation, Property 10: Model_Human_Agreement is bounded when paired and undefined otherwise.
// Validates: Requirements 8.1, 8.3, 8.4, 8.5, 8.6.
//
// For any set of model Evidence_Outcomes and any set of Human_Signals (expert
// review, flag, dispute), modelHumanAgreement returns `undefined` when there are
// zero signals or when no signal shares a (reportId, claimId) with any model
// outcome, and otherwise a finite real in [0,1] equal to agreeing/compared —
// producing identical output for identical input and referencing disputes/flags
// by report and claim id only (never a user identity).

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { modelHumanAgreement } from '../src/core/kpi';
import type { ModelOutcome, HumanSignal } from '../src/core/kpi';
import type { EvidenceOutcome } from '../src/types';

const NUL = '\u0000';
const key = (reportId: string, claimId: string) => `${reportId}${NUL}${claimId}`;

// The six defined Evidence_Outcomes. The outcome value never affects agreement
// (only the (reportId, claimId) pairing and the signal's own concurrence do), so a
// small constant set keeps generation cheap while staying faithful to the type.
const outcomeArb = fc.constantFrom<EvidenceOutcome>(
  'matched_fact_check',
  'matched_primary_source',
  'matched_institutional_source',
  'relevant_context_only',
  'no_sufficient_evidence',
  'not_fact_checkable',
);

const reviewStatusArb = fc.constantFrom('ai-generated', 'expert-reviewed', 'under-dispute' as const);

// Model outcomes live in a narrow id space so signals overlap them often.
const modelReportId = fc.constantFrom('r1', 'r2', 'r3');
const modelClaimId = fc.constantFrom('c1', 'c2', 'c3', 'c4');

// Signals draw from a slightly wider id space ('r9'/'c9') so some signals share no
// (reportId, claimId) with any outcome — exercising the undefined-for-lack-of-signal
// branch (Req 8.6) alongside the paired branch.
const signalReportId = fc.constantFrom('r1', 'r2', 'r3', 'r9');
const signalClaimId = fc.constantFrom('c1', 'c2', 'c3', 'c4', 'c9');

const modelOutcomeArb: fc.Arbitrary<ModelOutcome> = fc.record({
  reportId: modelReportId,
  claimId: modelClaimId,
  outcome: outcomeArb,
});

const signalArb: fc.Arbitrary<HumanSignal> = fc.oneof(
  fc.record({ kind: fc.constant('flag' as const), reportId: signalReportId, claimId: signalClaimId }),
  fc.record({ kind: fc.constant('dispute' as const), reportId: signalReportId, claimId: signalClaimId }),
  fc.record({
    kind: fc.constant('expert_review' as const),
    reportId: signalReportId,
    claimId: signalClaimId,
    reviewStatus: reviewStatusArb,
  }),
);

const outcomesArb = fc.array(modelOutcomeArb, { maxLength: 12 });
const signalsArb = fc.array(signalArb, { maxLength: 12 });

// Independent oracle of agreeing/compared. A flag or dispute is a disagreement; an
// expert review agrees only when 'expert-reviewed'; 'ai-generated' is not a human
// signal and is never paired (Req 8.3). A pair is compared iff the signal shares a
// (reportId, claimId) with some model outcome (Req 8.5, 8.6).
function expected(outcomes: ReadonlyArray<ModelOutcome>, signals: ReadonlyArray<HumanSignal>): number | undefined {
  const keys = new Set(outcomes.map((o) => key(o.reportId, o.claimId)));
  let agreeing = 0;
  let compared = 0;
  for (const s of signals) {
    if (s.kind === 'expert_review' && s.reviewStatus === 'ai-generated') continue;
    if (!keys.has(key(s.reportId, s.claimId))) continue;
    compared++;
    if (s.kind === 'expert_review' && s.reviewStatus === 'expert-reviewed') agreeing++;
  }
  return compared === 0 ? undefined : agreeing / compared;
}

test('Property 10: undefined iff unpaired, else a finite real in [0,1] equal to agreeing/compared', () => {
  fc.assert(
    fc.property(outcomesArb, signalsArb, (outcomes, signals) => {
      const result = modelHumanAgreement(outcomes, signals);

      // Matches the independent oracle (the agreeing/compared ratio, Req 8.5).
      assert.deepEqual(result, expected(outcomes, signals));

      if (result === undefined) {
        // Undefined-for-lack-of-signal: zero signals or no shared (reportId, claimId) (Req 8.4, 8.6).
        const keys = new Set(outcomes.map((o) => key(o.reportId, o.claimId)));
        const anyPaired = signals.some(
          (s) =>
            !(s.kind === 'expert_review' && s.reviewStatus === 'ai-generated') &&
            keys.has(key(s.reportId, s.claimId)),
        );
        assert.equal(anyPaired, false);
      } else {
        // Bounded finite real in [0,1] (Req 8.5).
        assert.ok(Number.isFinite(result));
        assert.ok(result >= 0 && result <= 1);
      }
    }),
    { numRuns: 300 },
  );
});

test('Property 10: identical output for identical input — pure and deterministic (Req 8.1)', () => {
  fc.assert(
    fc.property(outcomesArb, signalsArb, (outcomes, signals) => {
      const first = modelHumanAgreement(outcomes, signals);
      // Same arrays again, and structurally-equal deep clones: same output either way.
      assert.deepEqual(modelHumanAgreement(outcomes, signals), first);
      assert.deepEqual(
        modelHumanAgreement(structuredClone(outcomes), structuredClone(signals)),
        first,
      );
    }),
    { numRuns: 300 },
  );
});

test('Property 10: disputes/flags referenced by report+claim id only — user identity is never read (Req 8.7-adjacent)', () => {
  fc.assert(
    fc.property(outcomesArb, signalsArb, fc.string(), (outcomes, signals, identity) => {
      // Smuggle a user-identity field onto every signal; the deriver must ignore it
      // entirely (it keys solely on reportId/claimId), so the result is unchanged.
      const tagged = signals.map((s) => ({ ...s, userId: identity, channel: identity })) as HumanSignal[];
      assert.deepEqual(modelHumanAgreement(outcomes, tagged), modelHumanAgreement(outcomes, signals));
    }),
    { numRuns: 200 },
  );
});
