// Stage 1 of the Claim_Verification_Router: claim normalization + fact-checkability
// triage. This is the deterministic, offline stand-in for the LLM-backed
// ClaimNormalizer (providers/types.ts). It is a pure function of its input so the
// router's orchestration and the property tests (tasks 2.2–2.4) exercise router
// logic, not a model.
//
// ponytail: keyword/heuristic classifier, not a real claim understander. Ceiling:
// it cannot parse grammar, so a rhetorical→hypothesis transform is a strip-and-
// declarativize approximation. Upgrade path is the real LLM ClaimNormalizer behind
// the same interface — no caller changes. The contract it guarantees is what the
// requirements pin: exactly one ClaimType, exactly one FactCheckability, opinions
// never searched, factual events always checkable, rhetoric either becomes an
// explicit hypothesis or is honestly marked not_fact_checkable.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import type { ClaimNormalizer } from '../providers/types';
import type { ClaimType, FactCheckability } from '../types';

export interface NormalizedClaim {
  canonicalClaim: string;
  claimType: ClaimType;
  factCheckability: FactCheckability;
}

// ── Classification signals ──────────────────────────────────────────────────
// Only normative_opinion and implied_rhetorical change Fact_Checkability, so those
// two are detected carefully; the remaining checkable types (statistical, causal,
// quote_paraphrase, prediction, factual_event) only need a stable single label.

const OPINION =
  /\b(should|shouldn't|shouldnt|must|ought to|best|worst|greatest|finest|terrible|awful|horrible|beautiful|ugly|wonderful|amazing|fantastic|disgusting|i think|i believe|i feel|in my opinion|imo|we believe|deserves?|better than|worse than|overrated|underrated|love|hate)\b/i;

const STATISTICAL =
  /\d|\b(percent|average|median|rate|ratio|statistics?|per capita|billion|million|thousand|majority|minority)\b/i;

const CAUSAL = /\b(because|causes?|caused|leads? to|led to|due to|results? in|resulted in|thanks to|owing to)\b/i;

const QUOTE = /(["“”']).+?\1|\b(said|stated|according to|claimed|wrote|tweeted|quoted)\b/i;

const PREDICTION =
  /\b(will|won't|wont|shall|going to|gonna|by \d{4}|next year|in the future|predicts?|forecasts?|expected to)\b/i;

const FILLER_LEADIN =
  /^(well|honestly|frankly|look|listen|i mean|you know|basically|seriously|actually|to be honest)\b[\s,]*/i;

// Interrogative lead-ins stripped when turning a rhetorical question into a hypothesis.
const INTERROGATIVE_LEAD =
  /^(why|how|what's|whats|what|who's|whos|whom|whose|who|when|where|which|does|do|did|isn't|isnt|is|aren't|arent|are|am|was|were|doesn't|doesnt|don't|dont|didn't|didnt|can't|cant|can|could|couldn't|couldnt|would|wouldn't|wouldnt|will|won't|wont|should|shouldn't|shouldnt|really|seriously|honestly|so|but|and|maybe|perhaps|don't you think|dont you think|do you think|you really think|you think)\b[\s,]*/i;

// ── Small pure string helpers ────────────────────────────────────────────────

function cleanWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stripWrappingQuotes(s: string): string {
  return s.replace(/^["“”'`]+/, '').replace(/["“”'`]+$/, '').trim();
}

// Normalize any claim into an explicit declarative restatement: drop filler lead-ins
// and wrapping quotes, collapse whitespace, capitalize, and end on a single period.
// This is the Canonical_Claim derived from the Original_Claim (Req 1.8).
function declarativize(s: string): string {
  let out = cleanWhitespace(stripWrappingQuotes(s));
  out = cleanWhitespace(out.replace(FILLER_LEADIN, ''));
  if (out.length === 0) return out;
  out = out.replace(/[?!.…\s]+$/, '');
  if (out.length === 0) return out;
  return out.charAt(0).toUpperCase() + out.slice(1) + '.';
}

// Attempt to turn a rhetorical question into an explicit, checkable hypothesis.
// Returns null when no checkable proposition can be recovered (Req 1.7) — too little
// propositional content, no words, or a pure value judgment (which is not checkable).
function rhetoricalToHypothesis(text: string): string | null {
  let core = cleanWhitespace(stripWrappingQuotes(text)).replace(/\?+\s*$/, '');
  let prev: string;
  do {
    prev = core;
    core = core.replace(INTERROGATIVE_LEAD, '');
  } while (core !== prev && core.length > 0);
  core = cleanWhitespace(core);

  const words = core.split(/\s+/).filter(Boolean);
  if (words.length < 3) return null; // not enough to state a hypothesis
  if (!/[a-z]/i.test(core)) return null; // no alphabetic content
  if (OPINION.test(core)) return null; // a value judgment is not a checkable hypothesis
  return declarativize(core);
}

// ── Public API ────────────────────────────────────────────────────────────────

// Assign exactly one Claim_Type (Req 1.1). Rhetorical and opinion are detected first
// because they are the only labels that can force not_fact_checkable.
export function classifyClaimType(claim: string): ClaimType {
  const text = claim.trim();
  if (/\?\s*$/.test(text)) return 'implied_rhetorical';
  if (OPINION.test(text)) return 'normative_opinion';
  if (STATISTICAL.test(text)) return 'statistical';
  if (CAUSAL.test(text)) return 'causal';
  if (QUOTE.test(text)) return 'quote_paraphrase';
  if (PREDICTION.test(text)) return 'prediction';
  return 'factual_event';
}

// Pure normalization: Original_Claim -> { Canonical_Claim, Claim_Type, Fact_Checkability }.
// Guarantees the requirement-pinned behavior:
//   - normative_opinion        -> not_fact_checkable                       (Req 1.3)
//   - factual_event            -> checkable                                (Req 1.4)
//   - implied_rhetorical       -> checkable with an explicit hypothesis,   (Req 1.6)
//                                 or not_fact_checkable if none is found   (Req 1.7)
//   - everything else checkable, with a Canonical_Claim from the original  (Req 1.8)
export function normalizeClaim(originalClaim: string): NormalizedClaim {
  const claimType = classifyClaimType(originalClaim);

  if (claimType === 'normative_opinion') {
    return { canonicalClaim: declarativize(originalClaim), claimType, factCheckability: 'not_fact_checkable' };
  }

  if (claimType === 'implied_rhetorical') {
    const hypothesis = rhetoricalToHypothesis(originalClaim);
    if (hypothesis === null) {
      return { canonicalClaim: declarativize(originalClaim), claimType, factCheckability: 'not_fact_checkable' };
    }
    return { canonicalClaim: hypothesis, claimType, factCheckability: 'checkable' };
  }

  return { canonicalClaim: declarativize(originalClaim), claimType, factCheckability: 'checkable' };
}

// The deterministic seeded ClaimNormalizer used offline and in property tests.
export const seededNormalizer: ClaimNormalizer = {
  async normalize(originalClaim: string) {
    return normalizeClaim(originalClaim);
  },
};

// triage: the router's short-circuit decision (Req 1.5). Returns true when the claim
// is checkable and the router should proceed to query-pack + retrieval, false when it
// is not_fact_checkable and no Query_Pack/Provider_Chain call must be made.
export function triage(normalized: Pick<NormalizedClaim, 'factCheckability'>): boolean {
  return normalized.factCheckability === 'checkable';
}

// ponytail: one runnable self-check (run `node --import tsx src/router/normalize.ts`).
// The full property/example coverage is tasks 2.2–2.4; this only fails fast if the
// requirement-pinned behavior regresses.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const opinion = normalizeClaim('I think pineapple is the best pizza topping');
  assert.equal(opinion.claimType, 'normative_opinion');
  assert.equal(opinion.factCheckability, 'not_fact_checkable'); // Req 1.3
  assert.equal(triage(opinion), false); // Req 1.5

  const factual = normalizeClaim('The Berlin Wall fell in 1989');
  assert.equal(factual.factCheckability, 'checkable'); // Req 1.4
  assert.notEqual(factual.canonicalClaim, ''); // Req 1.8 derived canonical
  assert.equal(triage(factual), true);

  const rhetoricalOk = normalizeClaim("Isn't the national debt growing every single year?");
  assert.equal(rhetoricalOk.claimType, 'implied_rhetorical');
  assert.equal(rhetoricalOk.factCheckability, 'checkable'); // Req 1.6
  assert.ok(rhetoricalOk.canonicalClaim.endsWith('.'));

  const rhetoricalFail = normalizeClaim('Really?');
  assert.equal(rhetoricalFail.claimType, 'implied_rhetorical');
  assert.equal(rhetoricalFail.factCheckability, 'not_fact_checkable'); // Req 1.7

  console.log('normalize.ts self-check passed');
}
