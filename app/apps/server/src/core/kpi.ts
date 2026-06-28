// KPI_Deriver — the two red-line trust KPIs, derived purely from already-produced
// report data. Both functions are pure, total, and deterministic: they read the
// per-claim Evidence_Outcomes the router already decided and the Human_Signals
// already recorded; they make no external call and NEVER recompute or alter an
// Evidence_Outcome (Req 7.1, 7.7, 8.1). Lens, not a judge: nothing here attaches a
// reliability or truth verdict to a creator/channel — disputes and flags are
// referenced by report+claim id only, never by the disputing/flagging user's
// identity (Req 8.7, 8.8).

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import type { AuditRecord, EvidenceOutcome, Provenance } from '../types';

// The three Evidence_Outcomes that carry at least one ledger citation.
export const CITED_OUTCOMES: ReadonlySet<EvidenceOutcome> = new Set([
  'matched_fact_check',
  'matched_primary_source',
  'matched_institutional_source',
]);

// The three honest no-evidence outcomes (evidenceStrength = none): a valid, honest
// state, never a failure (Req 7.4, 11.4).
export const HONEST_NONE_OUTCOMES: ReadonlySet<EvidenceOutcome> = new Set([
  'relevant_context_only',
  'no_sufficient_evidence',
  'not_fact_checkable',
]);

// Citation_Coverage = |Cited_Outcome claims| / |claims carrying one of the six
// defined outcomes|, a finite real in [0,1] (Req 7.3, 7.5). An empty list yields
// exactly 0 — a valid honest-none result, not a failure (Req 7.4). A claim whose
// outcome is outside the six defined values is excluded from BOTH numerator and
// denominator, so the ratio stays bounded (Req 7.8). Reads `evidenceOutcome` only;
// the input audits are never mutated (Req 7.2, 7.6).
export function citationCoverage(
  audits: ReadonlyArray<Pick<AuditRecord, 'evidenceOutcome'>>,
): number {
  let cited = 0;
  let defined = 0;
  for (const { evidenceOutcome } of audits) {
    if (CITED_OUTCOMES.has(evidenceOutcome)) {
      cited++;
      defined++;
    } else if (HONEST_NONE_OUTCOMES.has(evidenceOutcome)) {
      defined++;
    }
    // out-of-enum: excluded from both numerator and denominator (Req 7.8).
  }
  return defined === 0 ? 0 : cited / defined;
}

// A model-produced Evidence_Outcome for one claim of one report.
export interface ModelOutcome {
  reportId: string;
  claimId: string;
  outcome: EvidenceOutcome;
}

// The three kinds of Human_Signal compared against the model outcomes (Req 8.2).
// Each references a report+claim id only — never a user identity (Req 8.7).
export type HumanSignal =
  | { kind: 'expert_review'; reportId: string; claimId: string; reviewStatus: Provenance['reviewStatus'] }
  | { kind: 'flag'; reportId: string; claimId: string }
  | { kind: 'dispute'; reportId: string; claimId: string };

const pairKey = (reportId: string, claimId: string): string => `${reportId}\u0000${claimId}`;

// Does this Human_Signal concur with the model? The concurrence rule lives ONLY
// here (Req 8.3): a flag or dispute is a human disagreement; an expert review
// agrees when `expert-reviewed` and disagrees when `under-dispute`. `ai-generated`
// is not a human signal and is filtered out before this is called.
function signalAgrees(signal: HumanSignal): boolean {
  if (signal.kind === 'expert_review') return signal.reviewStatus === 'expert-reviewed';
  return false; // flag / dispute => disagreement
}

// Model_Human_Agreement = agreeing pairs / compared pairs, a finite real in [0,1]
// (Req 8.5). Returns `undefined` when there are zero signals OR when no signal
// shares a (reportId, claimId) with any model outcome — undefined-for-lack-of-signal,
// not agreement or disagreement (Req 8.4, 8.6). Pure and deterministic (Req 8.1).
export function modelHumanAgreement(
  outcomes: ReadonlyArray<ModelOutcome>,
  signals: ReadonlyArray<HumanSignal>,
): number | undefined {
  const modelKeys = new Set<string>();
  for (const o of outcomes) modelKeys.add(pairKey(o.reportId, o.claimId));

  let agreeing = 0;
  let compared = 0;
  for (const signal of signals) {
    // `ai-generated` is not a human signal: never paired (Req 8.2 concurrence rule).
    if (signal.kind === 'expert_review' && signal.reviewStatus === 'ai-generated') continue;
    if (!modelKeys.has(pairKey(signal.reportId, signal.claimId))) continue;
    compared++;
    if (signalAgrees(signal)) agreeing++;
  }

  return compared === 0 ? undefined : agreeing / compared;
}

// ponytail: one runnable self-check (run `node --import tsx src/core/kpi.ts`).
// Full property coverage is tasks 3.2/3.3; this only fails fast if the ratio math,
// the bounds, the out-of-enum exclusion, or the undefined-for-lack-of-signal
// behavior regress.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  // Mixed list: 2 cited, 1 honest-none, 1 out-of-enum (excluded from both).
  const audits: Array<Pick<AuditRecord, 'evidenceOutcome'>> = [
    { evidenceOutcome: 'matched_fact_check' },
    { evidenceOutcome: 'matched_primary_source' },
    { evidenceOutcome: 'no_sufficient_evidence' },
    { evidenceOutcome: 'bogus_outcome' as EvidenceOutcome }, // out-of-enum
  ];
  const frozen = Object.freeze(audits.map((a) => Object.freeze({ ...a })));
  const coverage = citationCoverage(frozen);
  assert.equal(coverage, 2 / 3); // 2 cited / 3 defined-outcome claims (out-of-enum excluded)
  assert.ok(coverage >= 0 && coverage <= 1); // bounded
  assert.equal(citationCoverage([]), 0); // empty => 0, valid honest-none

  // Agreement: report+claim pairing, concurrence rule, undefined-for-lack-of-signal.
  const outcomes: ModelOutcome[] = [
    { reportId: 'r1', claimId: 'c1', outcome: 'matched_fact_check' },
    { reportId: 'r1', claimId: 'c2', outcome: 'no_sufficient_evidence' },
  ];
  assert.equal(modelHumanAgreement(outcomes, []), undefined); // zero signals
  assert.equal(
    modelHumanAgreement(outcomes, [{ kind: 'flag', reportId: 'rX', claimId: 'cX' }]),
    undefined, // no shared (reportId, claimId)
  );
  // c1: expert-reviewed (agree), c1: dispute (disagree), c2: flag (disagree) => 1/3.
  const agreement = modelHumanAgreement(outcomes, [
    { kind: 'expert_review', reportId: 'r1', claimId: 'c1', reviewStatus: 'expert-reviewed' },
    { kind: 'dispute', reportId: 'r1', claimId: 'c1' },
    { kind: 'flag', reportId: 'r1', claimId: 'c2' },
    { kind: 'expert_review', reportId: 'r1', claimId: 'c1', reviewStatus: 'ai-generated' }, // never paired
  ]);
  assert.equal(agreement, 1 / 3);
  assert.ok(agreement !== undefined && agreement >= 0 && agreement <= 1); // bounded

  console.log('kpi.ts self-check passed');
}
