// Router stage 6 (assemble outcome): the router-owned deterministic decisions.
//
// This file holds the gating, routing, Evidence_Outcome assignment, and the
// deterministic outcome→strength / outcome→vocabulary mappings. It is built up
// across tasks 6.1 (routing + excluded-tier hard gate), 6.3 (Evidence_Outcome
// assignment), and 6.5 (deterministic mappings); each concern is a separately
// exported, pure function so the stages compose without a combined score.
//
// Source reliability is NOT owned here: every Candidate already carries a
// Source_Tier from the trust-and-launch-bundle Source_Tier_Policy
// (classifyCitationTier). This stage only consumes that tier as one of four
// independent signals (retrieval rank, Source_Tier, Match_Type+Confidence,
// Evidence_Strength) and never collapses them into a single number.

import type {
  Candidate,
  Citation,
  ContextCard,
  EvidenceOutcome,
  EvidenceStrength,
  FactCheckability,
  PrototypeVocab,
  ValidatedCandidate,
} from '../types';

// ── Candidate routing + the excluded-tier hard gate (task 6.1) ───────────────

// The result of routing one claim's validated candidates. The three regions are
// kept disjoint: a candidate is evidence (a Citation in the Claim_Ledger),
// Useful_Context, a Context_Card, or discarded — never more than one.
export interface RoutingResult {
  citations: Citation[]; // Claim_Ledger evidence ONLY (same_claim / contradictory)
  usefulContext: Candidate[]; // same_topic_different_claim
  contextCards: ContextCard[]; // background_context
  routed: ValidatedCandidate[]; // inputs with selectedAsEvidence set by the gate
}

// Ledger eligibility is the conjunction of two INDEPENDENT binary gates (no
// combined score): the Match_Type must permit evidence AND the Source_Tier must
// not be `excluded`. A `same_claim` candidate from an unresolvable/excluded host
// is dropped from the ledger no matter how high its Match_Confidence (Req 5.2).
export function isLedgerEligible(vc: ValidatedCandidate): boolean {
  const matchPermits =
    vc.matchType === 'same_claim' || vc.matchType === 'contradictory_but_relevant';
  return matchPermits && vc.candidate.sourceTier !== 'excluded';
}

// A ledger-eligible candidate becomes a Citation. `supports` encodes the
// Match_Type: same_claim supports the claim, contradictory_but_relevant
// contradicts it (recorded with supports === false, Req 3.4).
function toCitation(vc: ValidatedCandidate): Citation {
  const c = vc.candidate;
  return {
    sourceUrl: c.sourceUrl,
    sourceName: c.sourceName,
    sourceTier: c.sourceTier,
    excerpt: c.excerpt,
    supports: vc.matchType === 'contradictory_but_relevant' ? false : true,
  };
}

// background_context candidates surface as Context_Cards (the report element for
// context the content omits). title/description are required; fall back to the
// source name when the candidate carried no excerpt.
function toContextCard(c: Candidate): ContextCard {
  return {
    title: c.sourceName,
    description: c.excerpt ?? c.sourceName,
    sourceName: c.sourceName,
    sourceUrl: c.sourceUrl,
  };
}

// Route each validated candidate per the design's "Candidate routing" table:
//   same_claim / contradictory_but_relevant → Claim_Ledger (iff tier ≠ excluded)
//   same_topic_different_claim              → Useful_Context
//   background_context                      → Context_Card
//   irrelevant                              → discarded
//   any candidate with tier === 'excluded'  → dropped from the ledger
// Pure: returns fresh objects and a copy of the inputs with selectedAsEvidence
// set to exactly the ledger-eligible candidates (it does not mutate the input).
export function routeCandidates(validated: ValidatedCandidate[]): RoutingResult {
  const citations: Citation[] = [];
  const usefulContext: Candidate[] = [];
  const contextCards: ContextCard[] = [];
  const routed: ValidatedCandidate[] = [];

  for (const vc of validated) {
    const selectedAsEvidence = isLedgerEligible(vc);
    routed.push({ ...vc, selectedAsEvidence });

    switch (vc.matchType) {
      case 'same_claim':
      case 'contradictory_but_relevant':
        // The excluded-tier hard gate: only resolvable tiers enter the ledger.
        if (selectedAsEvidence) citations.push(toCitation(vc));
        break;
      case 'same_topic_different_claim':
        usefulContext.push(vc.candidate);
        break;
      case 'background_context':
        contextCards.push(toContextCard(vc.candidate));
        break;
      case 'irrelevant':
        // discarded — appears nowhere (Req 3.7)
        break;
    }
  }

  return { citations, usefulContext, contextCards, routed };
}

// ── Evidence_Outcome assignment (task 6.3) ───────────────────────────────────

// Assign exactly one Evidence_Outcome for a claim from its routed candidates and
// its Fact_Checkability, per the design's 5-step algorithm:
//
//   1. not checkable + no ledger evidence → not_fact_checkable (Req 4.2)
//   2. ledger-eligible = the candidates routeCandidates marked selectedAsEvidence
//      (match_type ∈ {same_claim, contradictory_but_relevant} AND tier ≠ excluded)
//   3. if any ledger-eligible, pick the strongest by provenance order
//      fact_check > tier1_primary > institutional — this also OVERRIDES a prior
//      not_fact_checkable when retrieval nonetheless yielded ledger evidence
//      (Req 4.3; defensive, since triage normally short-circuits retrieval).
//   4. else if only routed context exists → relevant_context_only (Req 4.5)
//   5. else → no_sufficient_evidence (Req 4.4)
//
// Reuses routeCandidates' selectedAsEvidence flag (the excluded-tier hard gate)
// rather than re-deriving ledger eligibility, so the gate is owned in one place.
export function assignEvidenceOutcome(
  factCheckability: FactCheckability,
  routing: RoutingResult,
): EvidenceOutcome {
  const ledgerEligible = routing.routed.filter((vc) => vc.selectedAsEvidence);

  // Step 3: ledger evidence wins (and overrides not_fact_checkable). Provenance
  // order is strongest-first; the first matching tier decides the outcome.
  if (ledgerEligible.length > 0) {
    if (ledgerEligible.some((vc) => vc.candidate.isFactCheck)) return 'matched_fact_check';
    if (ledgerEligible.some((vc) => vc.candidate.sourceTier === 'tier1_primary'))
      return 'matched_primary_source';
    return 'matched_institutional_source';
  }

  // Step 1: not checkable and nothing made it into the ledger.
  if (factCheckability === 'not_fact_checkable') return 'not_fact_checkable';

  // Steps 4 & 5: checkable claim with no ledger evidence — context-only or none.
  if (routing.usefulContext.length > 0 || routing.contextCards.length > 0) {
    return 'relevant_context_only';
  }
  return 'no_sufficient_evidence';
}

// ── Deterministic outcome→strength / outcome→vocabulary mappings (task 6.5) ──

// Evidence_Outcome → Evidence_Strength (Req 4.7, 4.8). Total and single-valued
// over the six-member EvidenceOutcome union. This is the construction that keeps
// the Invariant_Gate satisfied: every outcome with strength ≠ 'none' is exactly
// the set of matched_* outcomes that carry ≥ 1 ledger citation, and every other
// outcome maps to 'none' and carries 0 citations (Req 9.3, 9.4). Both
// no_sufficient_evidence and not_fact_checkable map to 'none' (Req 4.8).
const OUTCOME_TO_STRENGTH: Record<EvidenceOutcome, EvidenceStrength> = {
  matched_fact_check: 'strong',
  matched_primary_source: 'moderate',
  matched_institutional_source: 'weak',
  relevant_context_only: 'none',
  no_sufficient_evidence: 'none',
  not_fact_checkable: 'none',
};

// Total, single-valued, stable across calls — a pure lookup over the union.
export function outcomeToStrength(outcome: EvidenceOutcome): EvidenceStrength {
  return OUTCOME_TO_STRENGTH[outcome];
}

// Evidence_Outcome → prototype vocabulary base (Req 4.9). matched_* → supported,
// relevant_context_only → weak, no_sufficient_evidence / not_fact_checkable →
// insufficient. The `mixed` value is never a base; it is only ever produced by
// the override below.
const OUTCOME_TO_VOCAB_BASE: Record<EvidenceOutcome, PrototypeVocab> = {
  matched_fact_check: 'supported',
  matched_primary_source: 'supported',
  matched_institutional_source: 'supported',
  relevant_context_only: 'weak',
  no_sufficient_evidence: 'insufficient',
  not_fact_checkable: 'insufficient',
};

// True iff the outcome is one of the three matched_* outcomes (the only ones
// whose ledger can carry both a supporting and a contradicting citation).
function isMatchedOutcome(outcome: EvidenceOutcome): boolean {
  return (
    outcome === 'matched_fact_check' ||
    outcome === 'matched_primary_source' ||
    outcome === 'matched_institutional_source'
  );
}

// (Evidence_Outcome, hasSupporting, hasContradicting) → PrototypeVocab (Req 4.9).
// Total and single-valued: the base mapping decides the vocabulary, with one
// override — when a matched_* outcome's ledger carries BOTH a supporting
// (same_claim) and a contradicting (contradictory_but_relevant) citation, the
// displayed vocabulary is `mixed`. hasSupporting/hasContradicting are ignored for
// non-matched outcomes (their ledger holds no citations), keeping the function
// total over every combination.
export function outcomeToVocab(
  outcome: EvidenceOutcome,
  hasSupporting: boolean,
  hasContradicting: boolean,
): PrototypeVocab {
  if (isMatchedOutcome(outcome) && hasSupporting && hasContradicting) return 'mixed';
  return OUTCOME_TO_VOCAB_BASE[outcome];
}
