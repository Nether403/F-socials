// Stage 5 of the Claim_Verification_Router: candidate validation.
//
// The Candidate_Validator classifies each retrieved Candidate against the
// Original_Claim (never the Query_Variant text that surfaced it — Req 3.2) with
// exactly one Match_Type and a Match_Confidence in [0,1] (Req 3.1).
//
// This module ships:
//   - `seededValidator`: a deterministic, offline mock implementing the
//     CandidateValidator provider interface. It produces varied-but-stable
//     Match_Type/Match_Confidence from a hash of (originalClaim, candidate) so the
//     router's routing/outcome logic can be exercised by property tests without an
//     LLM. The real provider is LLM-backed and swaps in behind the same interface.
//   - `safeValidate`: a precision-biased wrapper that clamps out-of-range
//     confidence into [0,1] (noting the clamp) and treats any validator throw as
//     `irrelevant` — the safe default, so a validator that cannot judge a candidate
//     never lets it into the Claim_Ledger (design "Error Handling").

import { createHash } from 'node:crypto';
import type { CandidateValidator } from '../providers/types';
import type { Candidate, MatchType } from '../types';

// The five-member Match_Type set, in a fixed order so the seeded pick is stable.
export const MATCH_TYPES: readonly MatchType[] = [
  'same_claim',
  'same_topic_different_claim',
  'background_context',
  'contradictory_but_relevant',
  'irrelevant',
];

// Deterministic 32-bit unsigned seed from a string (sha256 prefix). Reuses the
// node:crypto pattern already used by core/hash.ts rather than adding a PRNG dep.
function seed(input: string): number {
  return parseInt(createHash('sha256').update(input).digest('hex').slice(0, 8), 16) >>> 0;
}

// ponytail: deterministic stand-in, not real semantic matching. It hashes the
// Original_Claim together with the candidate's URL + excerpt so the same pair always
// yields the same judgment and varied inputs spread across all five Match_Types.
// Ceiling: no actual relevance reasoning; upgrade path is the LLM-backed validator
// swapped in via the CandidateValidator interface (composition root, task 11.3).
export const seededValidator: CandidateValidator = {
  async validate(originalClaim: string, candidate: Candidate) {
    // Classify against the ORIGINAL claim (Req 3.2), never the variant text.
    const s = seed(`${originalClaim}\u0000${candidate.sourceUrl}\u0000${candidate.excerpt ?? ''}`);
    // Modulo keeps the index in range; assert non-null for noUncheckedIndexedAccess.
    const matchType = MATCH_TYPES[s % MATCH_TYPES.length]!;
    // Spread confidence over [0,1] in 0.01 steps from independent bits of the seed.
    const matchConfidence = ((s >>> 8) % 101) / 100;
    return { matchType, matchConfidence };
  },
};

export interface SafeValidation {
  matchType: MatchType;
  matchConfidence: number; // guaranteed within [0,1]
  clamped: boolean; // true if the validator returned an out-of-range/invalid confidence
}

// Clamp a possibly-misbehaving confidence into [0,1]. A non-finite value (NaN,
// ±Infinity) is treated as out of range and pinned to 0 (the candidate is not
// silently trusted). Returns whether a clamp occurred so the Audit_Record can note it.
export function clampConfidence(raw: number): { value: number; clamped: boolean } {
  if (!Number.isFinite(raw)) return { value: 0, clamped: true };
  if (raw < 0) return { value: 0, clamped: true };
  if (raw > 1) return { value: 1, clamped: true };
  return { value: raw, clamped: false };
}

// Precision-biased wrapper around any CandidateValidator. Always passes the
// Original_Claim to the validator. A throw resolves to `irrelevant` (the candidate
// is discarded, never laundered into the ledger); an out-of-range confidence is
// clamped and flagged.
export async function safeValidate(
  validator: CandidateValidator,
  originalClaim: string,
  candidate: Candidate,
): Promise<SafeValidation> {
  let matchType: MatchType;
  let rawConfidence: number;
  try {
    const result = await validator.validate(originalClaim, candidate);
    matchType = result.matchType;
    rawConfidence = result.matchConfidence;
  } catch {
    // Safe default: a validator that cannot judge a candidate must never let it in.
    return { matchType: 'irrelevant', matchConfidence: 0, clamped: false };
  }
  const { value, clamped } = clampConfidence(rawConfidence);
  return { matchType, matchConfidence: value, clamped };
}
