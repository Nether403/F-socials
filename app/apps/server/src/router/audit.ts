// Router stage 6 (assemble outcome), audit half: the Audit_Record builder.
//
// `buildAuditRecord` produces exactly one complete, persistable Audit_Record per
// claim (Req 6.1). It is a pure function of the stage outputs the orchestrator
// (verifyClaim, task 8.1) already holds: the normalized claim, the Query_Pack, the
// validated+routed candidates, and the assembled outcome/strength/vocab. The router
// owns no scoring here — it only records what the earlier stages decided.
//
// The record keeps the four (here five) per-candidate signals DISTINCT and never
// collapsed into a single score (Req 5.4, 6.4): selected-as-evidence, Match_Type,
// Match_Confidence live on the ValidatedCandidate; Source_Tier and retrieval rank
// live on its inner Candidate. Passing ValidatedCandidate[] straight through is
// exactly what preserves that separation.
//
// Two requirement-pinned invariants are enforced BY CONSTRUCTION rather than trusted
// from the caller:
//   - Original_Claim and Canonical_Claim are recorded as distinct fields (Req 1.9).
//   - A `not_fact_checkable` claim records an empty Query_Pack and empty Candidate
//     results, because it was never searched (Req 6.6). The builder clears both
//     regardless of what it is handed, so the "not searched" record can never lie.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  AuditRecord,
  ClaimType,
  EvidenceOutcome,
  EvidenceStrength,
  FactCheckability,
  PrototypeVocab,
  QueryVariant,
  ValidatedCandidate,
} from '../types';

// Everything the builder needs, sourced from the six stages. `claimId` and
// `createdAt` are injectable for stable test/persistence ids and clocks; both have
// safe defaults (a fresh UUID and the current instant) so the orchestrator can omit
// them in the common case.
export interface AuditInput {
  claimId?: string; // defaults to randomUUID(); matches the Claim.id pattern used elsewhere
  originalClaim: string;
  canonicalClaim: string;
  claimType: ClaimType;
  factCheckability: FactCheckability;
  queryPack: QueryVariant[]; // forced empty when not_fact_checkable (Req 6.6)
  candidates: ValidatedCandidate[]; // forced empty when not_fact_checkable (Req 6.6)
  evidenceOutcome: EvidenceOutcome;
  evidenceStrength: EvidenceStrength;
  prototypeVocab: PrototypeVocab;
  createdAt?: string; // ISO; defaults to now
}

// Build the single Audit_Record for one processed claim. Pure: returns a fresh
// object and copies the input arrays (no aliasing, no mutation of the caller's data).
export function buildAuditRecord(input: AuditInput): AuditRecord {
  const notCheckable = input.factCheckability === 'not_fact_checkable';

  // Req 6.6: a not-searched claim must show an empty pack and no candidates — the
  // honest "not searched" record. Otherwise pass the stage outputs through verbatim,
  // copying so the persisted record can't be mutated from under us.
  const queryPack = notCheckable ? [] : [...input.queryPack];
  const candidates = notCheckable ? [] : [...input.candidates];

  return {
    claimId: input.claimId ?? randomUUID(),
    originalClaim: input.originalClaim, // Req 1.9: distinct from canonicalClaim
    canonicalClaim: input.canonicalClaim,
    claimType: input.claimType,
    factCheckability: input.factCheckability,
    queryPack,
    candidates,
    evidenceOutcome: input.evidenceOutcome,
    evidenceStrength: input.evidenceStrength,
    prototypeVocab: input.prototypeVocab,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

// ponytail: one runnable self-check (run `node --import tsx src/router/audit.ts`).
// Full property coverage is task 7.2; this only fails fast if the two
// build-by-construction invariants (distinct claims, empty-when-not-checkable)
// regress.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const candidate: ValidatedCandidate = {
    candidate: {
      sourceUrl: 'https://example.org/a',
      sourceName: 'Example',
      excerpt: 'x',
      sourceTier: 'tier2_institutional',
      isFactCheck: false,
      fromVariant: 'exact_normalized',
      retrievalRank: 0,
    },
    matchType: 'same_claim',
    matchConfidence: 0.9,
    selectedAsEvidence: true,
  };

  // Checkable claim: pack + candidates pass through, all five per-candidate signals present.
  const checkable = buildAuditRecord({
    originalClaim: 'Honestly, the bridge opened in 2011',
    canonicalClaim: 'The bridge opened in 2011.',
    claimType: 'factual_event',
    factCheckability: 'checkable',
    queryPack: [{ text: 'bridge opened 2011', kind: 'exact_normalized' }],
    candidates: [candidate],
    evidenceOutcome: 'matched_institutional_source',
    evidenceStrength: 'weak',
    prototypeVocab: 'supported',
  });
  assert.notEqual(checkable.originalClaim, checkable.canonicalClaim); // Req 1.9
  assert.equal(checkable.queryPack.length, 1);
  assert.equal(checkable.candidates.length, 1);
  const rec = checkable.candidates[0]!;
  // Four (five) distinct signals, never collapsed (Req 5.4, 6.4).
  assert.equal(rec.selectedAsEvidence, true);
  assert.equal(rec.matchType, 'same_claim');
  assert.equal(rec.matchConfidence, 0.9);
  assert.equal(rec.candidate.sourceTier, 'tier2_institutional');
  assert.equal(rec.candidate.retrievalRank, 0);
  assert.ok(checkable.claimId.length > 0); // generated UUID
  assert.ok(!Number.isNaN(Date.parse(checkable.createdAt))); // ISO

  // not_fact_checkable: pack + candidates forced empty even if (wrongly) supplied (Req 6.6).
  const notCheckable = buildAuditRecord({
    claimId: 'fixed-id',
    originalClaim: 'Pineapple is the best topping',
    canonicalClaim: 'Pineapple is the best topping.',
    claimType: 'normative_opinion',
    factCheckability: 'not_fact_checkable',
    queryPack: [{ text: 'should not be here', kind: 'exact_normalized' }],
    candidates: [candidate],
    evidenceOutcome: 'not_fact_checkable',
    evidenceStrength: 'none',
    prototypeVocab: 'insufficient',
    createdAt: '2024-01-01T00:00:00.000Z',
  });
  assert.equal(notCheckable.queryPack.length, 0); // Req 6.6
  assert.equal(notCheckable.candidates.length, 0); // Req 6.6
  assert.equal(notCheckable.claimId, 'fixed-id'); // injected id honored
  assert.equal(notCheckable.createdAt, '2024-01-01T00:00:00.000Z');

  console.log('audit.ts self-check passed');
}
