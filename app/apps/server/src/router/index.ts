// The Claim_Verification_Router orchestration: verifyClaim() sequences the six
// stages (normalize → triage → query pack → retrieve → validate → assemble outcome)
// around the EXISTING evidence providers, inside the existing Worker/Pipeline. No new
// service, no weighted score (Requirements 1.5, 1.7, 3.2, 4.1, 7.3).
//
// This file is pure glue: every decision lives in an already-implemented, separately
// tested module. verifyClaim only wires them and applies the design's error-handling
// defaults so one troubled claim never fails a whole report and never weakens the
// Invariant_Gate:
//   - normalizer throw            → not_fact_checkable (no search, honest none)
//   - per-variant retrieval throw → that variant contributes zero candidates
//   - all variants fail           → no_sufficient_evidence (a served outcome, Req 7.3)
//   - validator throw             → that candidate is irrelevant (safeValidate)
//
// The output satisfies the Invariant_Gate by construction: strength ≠ 'none' is
// exactly the matched_* set that carries ≥ 1 ledger citation, and every other outcome
// maps to 'none' with zero citations (Req 9.3, 9.4) — see outcome.ts mappings.

import type {
  Candidate,
  Citation,
  ClaimType,
  ContextCard,
  EvidenceOutcome,
  EvidenceStrength,
  FactCheckability,
  PrototypeVocab,
  QueryVariant,
  SourceTier,
  ValidatedCandidate,
} from '../types';
import type { CandidateValidator, ClaimNormalizer } from '../providers/types';
import { Semaphore } from '../concurrency';
import { triage } from './normalize';
import { QueryPackGenerator } from './queryPack';
import { safeValidate } from './validate';
import {
  assignEvidenceOutcome,
  outcomeToStrength,
  outcomeToVocab,
  routeCandidates,
} from './outcome';
import { buildAuditRecord } from './audit';

// The router's dependencies (design "Router orchestration interface"). `retrieve`
// wraps the existing provider list (makeRetrieve, retrieve.ts) and already stamps each
// Candidate's Source_Tier from the policy; `classifyTier` is the same policy
// (classifyCitationTier) kept on the contract for callers/future use — retrieval is
// the single site that applies it (Property 9), so the orchestrator does not
// re-classify.
export interface VerifyDeps {
  normalizer: ClaimNormalizer;
  validator: CandidateValidator;
  retrieve: (variant: QueryVariant) => Promise<Candidate[]>;
  classifyTier: (sourceUrl: string) => SourceTier; // classifyCitationTier
  semaphore?: Semaphore; // shared per-report scheduler; absent ⇒ standalone cap-1 (back-compat)
}

// What Stage 3 of the pipeline consumes to build a Claim plus the report's context
// regions and the per-claim Audit_Record.
export interface VerifiedClaim {
  evidenceOutcome: EvidenceOutcome;
  evidenceStrength: EvidenceStrength; // fed to the existing Claim
  prototypeVocab: PrototypeVocab;
  citations: Citation[]; // ledger evidence ONLY
  usefulContext: Candidate[]; // same_topic_different_claim
  contextCards: ContextCard[]; // background_context
  audit: ReturnType<typeof buildAuditRecord>;
}

// Normalize the claim, defaulting to not_fact_checkable if the normalizer throws or
// times out (design "Error Handling"): the safe, precision-biased default — no search,
// no citations, honest "not checkable". The fallback canonical is the original text
// and the type is implied_rhetorical, the claim shape whose un-transformable case Req
// 1.7 already maps to not_fact_checkable.
async function normalizeSafe(
  normalizer: ClaimNormalizer,
  originalClaim: string,
): Promise<{ canonicalClaim: string; claimType: ClaimType; factCheckability: FactCheckability }> {
  try {
    return await normalizer.normalize(originalClaim);
  } catch {
    return {
      canonicalClaim: originalClaim,
      claimType: 'implied_rhetorical',
      factCheckability: 'not_fact_checkable',
    };
  }
}

/**
 * Verify one extracted claim. Sequences the six router stages and returns the evidence
 * fields the pipeline needs (outcome, strength, prototype vocab, ledger citations,
 * routed context regions) plus the complete Audit_Record.
 *
 * @param originalClaim the exact extracted claim text — passed UNCHANGED to the
 *   validator at every candidate (Req 3.2); never a Query_Variant's text.
 * @param deps the normalizer, validator, per-variant retrieve, and tier policy.
 */
export async function verifyClaim(originalClaim: string, deps: VerifyDeps): Promise<VerifiedClaim> {
  // Stage 1: normalize (safe-defaulted to not_fact_checkable on failure).
  const normalized = await normalizeSafe(deps.normalizer, originalClaim);

  // Stage 2: triage. A not_fact_checkable claim is never searched — no Query_Pack and
  // zero Provider_Chain calls (Req 1.5, 1.7). Short-circuit BEFORE any query pack or
  // retrieval, emitting an honest not_fact_checkable result with empty pack/candidates.
  if (!triage(normalized)) {
    return assemble(originalClaim, normalized, [], [], 'not_fact_checkable');
  }

  // Stage 3: query pack from the Canonical_Claim (Req 2.5).
  const queryPack = QueryPackGenerator.generate(normalized.canonicalClaim);

  // Stage 4: retrieve per variant, in parallel, gated by the shared semaphore. Results
  // are written into perVariant[j] so completion order never affects candidate order
  // (Req 3.4); a variant whose retrieval throws contributes zero candidates (Req 4.2),
  // and if every variant fails candidates stays empty and the outcome resolves to
  // no_sufficient_evidence below (a served outcome, Req 7.3). normalize/triage already
  // ran outside the semaphore, so a not_fact_checkable claim short-circuits with zero
  // acquisitions (Req 5.3). Absent a shared semaphore, a standalone cap-1 keeps the
  // serial baseline behavior (back-compat).
  const sem = deps.semaphore ?? new Semaphore(1);
  const perVariant: Candidate[][] = new Array(queryPack.length);
  await Promise.all(
    queryPack.map(async (variant, j) => {
      try {
        perVariant[j] = await sem.run(() => deps.retrieve(variant)); // 1 acquire = 1 Provider_Chain submission
      } catch {
        perVariant[j] = []; // zero candidates for this variant
      }
    }),
  );
  const candidates: Candidate[] = perVariant.flat(); // variant-index order, then in-variant order (Req 3.4)

  // Stage 5: validate each candidate against the ORIGINAL claim (Req 3.2), never the
  // variant text. safeValidate clamps out-of-range confidence and treats a throw as
  // irrelevant (precision-biased default).
  const validated: ValidatedCandidate[] = [];
  for (const candidate of candidates) {
    const v = await safeValidate(deps.validator, originalClaim, candidate);
    validated.push({
      candidate,
      matchType: v.matchType,
      matchConfidence: v.matchConfidence,
      selectedAsEvidence: false, // routeCandidates sets this from the gates
    });
  }

  // Stage 6: route + assign Evidence_Outcome.
  const routing = routeCandidates(validated);
  const outcome = assignEvidenceOutcome(normalized.factCheckability, routing);

  return assemble(originalClaim, normalized, queryPack, routing.routed, outcome, routing);
}

// Shared assembly for both the short-circuit (not_fact_checkable) and full paths.
// Maps the outcome deterministically to strength + prototype vocab, takes ledger
// citations only, and builds the Audit_Record. When there is no routing (the triage
// short-circuit), citations/context are empty and the audit builder forces an empty
// pack and empty candidates (Req 6.6).
function assemble(
  originalClaim: string,
  normalized: { canonicalClaim: string; claimType: ClaimType; factCheckability: FactCheckability },
  queryPack: QueryVariant[],
  routedCandidates: ValidatedCandidate[],
  outcome: EvidenceOutcome,
  routing?: ReturnType<typeof routeCandidates>,
): VerifiedClaim {
  const citations = routing?.citations ?? [];
  const usefulContext = routing?.usefulContext ?? [];
  const contextCards = routing?.contextCards ?? [];

  const evidenceStrength = outcomeToStrength(outcome);
  const hasSupporting = citations.some((c) => c.supports === true);
  const hasContradicting = citations.some((c) => c.supports === false);
  const prototypeVocab = outcomeToVocab(outcome, hasSupporting, hasContradicting);

  const audit = buildAuditRecord({
    originalClaim,
    canonicalClaim: normalized.canonicalClaim,
    claimType: normalized.claimType,
    factCheckability: normalized.factCheckability,
    queryPack,
    candidates: routedCandidates,
    evidenceOutcome: outcome,
    evidenceStrength,
    prototypeVocab,
  });

  return {
    evidenceOutcome: outcome,
    evidenceStrength,
    prototypeVocab,
    citations,
    usefulContext,
    contextCards,
    audit,
  };
}

// ponytail: one runnable self-check (run `node --import tsx src/router/index.ts`).
// Full property coverage is tasks 8.2–8.4 (index.test.ts / invariant-moat.test.ts);
// this only fails fast if the orchestration wiring regresses — the triage
// short-circuit, validating against the ORIGINAL claim, and the strength↔citation
// moat. Uses inline stub deps so it stays dependency-free and offline. ESM top-level
// await runs only when the module is invoked directly.
if (process.argv[1] && process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url)) {
  // Explicit type annotation: assertion-signature methods (assert.ok, etc.) require
  // the call target to be a name with an explicit type (TS2775), which a plain
  // `const x = (await import(...)).default` inference does not satisfy.
  const assert: typeof import('node:assert').strict = (await import('node:assert/strict')).default;
  const { seededNormalizer } = await import('./normalize');
  const { seededValidator } = await import('./validate');

  // A retrieve that records every variant text it is asked for, returning one
  // tier2 institutional candidate (so a checkable claim can reach the ledger).
  const seenVariants: string[] = [];
  const oneCandidate = (text: string): Candidate[] => {
    seenVariants.push(text);
    return [
      {
        sourceUrl: 'https://www.example.org/a',
        sourceName: 'Example Institution',
        excerpt: 'x',
        sourceTier: 'tier2_institutional',
        isFactCheck: false,
        fromVariant: 'exact_normalized',
        retrievalRank: 0,
      },
    ];
  };
  const baseDeps: VerifyDeps = {
    normalizer: seededNormalizer,
    validator: seededValidator,
    retrieve: async (v) => oneCandidate(v.text),
    classifyTier: () => 'tier2_institutional',
  };

  // 1) Triage short-circuit (Req 1.5, 1.7): an opinion is never searched.
  let retrieved = false;
  const opinion = await verifyClaim('I think pineapple is the best topping', {
    ...baseDeps,
    retrieve: async (v) => {
      retrieved = true;
      return oneCandidate(v.text);
    },
  });
  assert.equal(retrieved, false); // no Provider_Chain call
  assert.equal(opinion.evidenceOutcome, 'not_fact_checkable');
  assert.equal(opinion.evidenceStrength, 'none');
  assert.equal(opinion.citations.length, 0);
  assert.equal(opinion.audit.queryPack.length, 0); // empty pack (Req 6.6)
  assert.equal(opinion.audit.candidates.length, 0); // empty candidates (Req 6.6)

  // 2) Candidates validated against the ORIGINAL claim, never a variant (Req 3.2).
  const ORIGINAL = 'The Berlin Wall fell in 1989';
  let validatedAgainst = '';
  await verifyClaim(ORIGINAL, {
    ...baseDeps,
    validator: {
      async validate(originalClaim, candidate) {
        validatedAgainst = originalClaim;
        return seededValidator.validate(originalClaim, candidate);
      },
    },
  });
  assert.equal(validatedAgainst, ORIGINAL);
  assert.ok(!seenVariants.includes(ORIGINAL) || seenVariants.length > 1); // variants differ from original

  // 3) The moat (Property 12): strength 'none' ⇒ 0 citations; strength ≠ 'none' ⇒ ≥ 1.
  // Force every candidate to same_claim so a checkable claim reaches the ledger.
  const matched = await verifyClaim(ORIGINAL, {
    ...baseDeps,
    validator: { async validate() { return { matchType: 'same_claim', matchConfidence: 1 }; } },
  });
  assert.notEqual(matched.evidenceStrength, 'none');
  assert.ok(matched.citations.length >= 1);
  assert.equal(matched.evidenceOutcome, 'matched_institutional_source');

  // 4) All variants fail retrieval → no_sufficient_evidence (a served outcome, Req 7.3).
  const allFail = await verifyClaim(ORIGINAL, {
    ...baseDeps,
    retrieve: async () => {
      throw new Error('provider down');
    },
  });
  assert.equal(allFail.evidenceOutcome, 'no_sufficient_evidence');
  assert.equal(allFail.evidenceStrength, 'none');
  assert.equal(allFail.citations.length, 0);

  console.log('index.ts self-check passed');
}
