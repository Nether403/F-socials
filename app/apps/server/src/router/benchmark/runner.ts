// Offline Benchmark + False_Evidence_Rate + Ship_Gate (Requirements 8.3–8.6).
//
// The single governing metric of this whole feature is the False_Evidence_Rate:
// a wrong citation is far worse than a missing one. This module measures it offline
// for two retrieval strategies — the existing first-wins `current_chain` and the
// precision `router` — and gates adoption on the result.
//
// Four requirement-pinned behaviors live here, each a small pure/decoupled piece so
// the property tests (tasks 12.3–12.5) exercise the logic, not the network:
//
//   - falseEvidenceRate (Req 8.3): the fraction of benchmark claims for which a
//     strategy cited a URL that does NOT actually match the claim — a URL absent
//     from the claim's acceptable set, or present in its unacceptable set. An honest
//     no-citation claim is never counted as false evidence (a missed citation is not
//     a wrong one).
//   - shipGate (Req 8.4): approve the router iff FER_router ≤ FER_current.
//   - runStrategy / runBenchmark (Req 8.5, 8.6): feed the SAME pre-extracted claim
//     text to every strategy, claim for claim, holding the extraction model constant
//     so the extraction-count confound cannot distort the comparison; run entirely
//     offline (claims are injected, strategies are injected — no network, no user).
//
// The runner is deliberately strategy-agnostic: a `Strategy` is just "given a claim
// text, which URLs would you cite as evidence?". This keeps the benchmark decoupled
// from how either strategy is built, and lets the property tests drive it with spy
// strategies. Concrete adapters for the existing chain and the existing router pieces
// are provided below for an actual offline run.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import type { EvidenceOutcome, SourceTier, ValidatedCandidate } from '../../types';
import type { CandidateValidator, ClaimNormalizer, EvidenceProvider } from '../../providers/types';
import { QueryPackGenerator } from '../queryPack';
import { triage } from '../normalize';
import { makeRetrieve, type RetrievalSource } from '../retrieve';
import { safeValidate } from '../validate';
import { routeCandidates } from '../outcome';

// ── Benchmark data model (design "Offline Benchmark model") ──────────────────

export type StrategyName = 'current_chain' | 'router';

// One labeled benchmark claim. `originalClaim` is PRE-EXTRACTED text: the extraction
// model is held constant by feeding this exact string to every strategy (Req 8.6).
export interface BenchmarkClaim {
  id: string;
  originalClaim: string;
  sourceKind: 'video' | 'article';
  language: 'en' | 'nl';
  category: 'recent_local' | 'known_misinfo' | 'mundane_factual' | 'other';
  idealOutcome: EvidenceOutcome;
  acceptableUrls: string[];
  unacceptableUrls: string[];
}

export interface StrategyResult {
  strategy: StrategyName;
  falseEvidenceRate: number; // fraction citing an unacceptable / non-matching URL, in [0,1]
}

// A retrieval strategy under test. Offline: given a pre-extracted claim text, it
// returns the URLs it would cite as evidence for that claim (empty = honest none).
export interface Strategy {
  name: StrategyName;
  citeUrls(claimText: string): Promise<string[]>;
}

// One claim paired with the URLs a strategy cited for it — the unit FER scores over.
export interface ClaimCitations {
  claim: BenchmarkClaim;
  citedUrls: string[];
}

export interface BenchmarkReport {
  results: StrategyResult[];
  // Ship_Gate decision: true iff a `router` result exists and is no worse than
  // `current_chain`. Undefined-when-incomparable collapses to false (fail closed).
  approved: boolean;
}

// ── False_Evidence_Rate (Req 8.3, Property 14) ───────────────────────────────

// A single cited URL is "false evidence" for a claim when it is not in the claim's
// acceptable set OR it is in the unacceptable set. The two conditions overlap by
// design (an unacceptable URL is also "not acceptable"); both are stated so the
// intent — explicitly-flagged-wrong and silently-not-right are equally false — is
// legible and robust if a URL ever appears on both lists.
export function isFalseEvidenceUrl(claim: BenchmarkClaim, url: string): boolean {
  return claim.unacceptableUrls.includes(url) || !claim.acceptableUrls.includes(url);
}

// The False_Evidence_Rate: the fraction of claims for which the strategy cited at
// least one false-evidence URL. A claim with no cited URLs contributes nothing (an
// honest "no sufficient evidence" is not a wrong citation). Always in [0,1]; an empty
// claim set is rate 0 (no false citations possible).
export function falseEvidenceRate(entries: ClaimCitations[]): number {
  if (entries.length === 0) return 0;
  const falseCount = entries.filter((e) =>
    e.citedUrls.some((url) => isFalseEvidenceUrl(e.claim, url)),
  ).length;
  return falseCount / entries.length;
}

// ── Ship_Gate (Req 8.4, Property 15) ─────────────────────────────────────────

// Approve adoption of the router iff its False_Evidence_Rate is equal to or lower
// than the current chain's. Equality approves: a tie on the governing metric is not
// a regression. This is the entire decision rule — no other signal overrides it.
export function shipGate(ferRouter: number, ferCurrent: number): boolean {
  return ferRouter <= ferCurrent;
}

// ── The runner (Req 8.5 offline, Req 8.6 extraction held constant) ───────────

// Run one strategy over the benchmark claims, feeding each claim's pre-extracted
// `originalClaim` verbatim (Req 8.6) and collecting the URLs it cites. Returns both
// the headline StrategyResult and the per-claim entries (useful for diagnostics and
// for the FER property test). Offline: the only inputs are the injected claims and
// the injected strategy.
export async function runStrategy(
  strategy: Strategy,
  claims: BenchmarkClaim[],
): Promise<{ result: StrategyResult; entries: ClaimCitations[] }> {
  const entries: ClaimCitations[] = [];
  for (const claim of claims) {
    // The same pre-extracted claim text every strategy sees — the extraction model
    // is constant by construction (Req 8.6, Property 16).
    const citedUrls = await strategy.citeUrls(claim.originalClaim);
    entries.push({ claim, citedUrls });
  }
  return {
    result: { strategy: strategy.name, falseEvidenceRate: falseEvidenceRate(entries) },
    entries,
  };
}

// Run the full benchmark across every strategy and apply the Ship_Gate. Every
// strategy is fed the identical claim list, so the claim text supplied to each is
// identical claim-for-claim (Req 8.6). Approval requires both a `router` and a
// `current_chain` result; absent either, it fails closed.
export async function runBenchmark(
  claims: BenchmarkClaim[],
  strategies: Strategy[],
): Promise<BenchmarkReport> {
  const results: StrategyResult[] = [];
  for (const strategy of strategies) {
    const { result } = await runStrategy(strategy, claims);
    results.push(result);
  }
  const router = results.find((r) => r.strategy === 'router');
  const current = results.find((r) => r.strategy === 'current_chain');
  const approved =
    router !== undefined && current !== undefined
      ? shipGate(router.falseEvidenceRate, current.falseEvidenceRate)
      : false;
  return { results, approved };
}

// ── Concrete strategy adapters (offline, reuse existing pieces) ──────────────

// `current_chain`: the existing first-wins Provider_Chain behavior. Pass the chained
// EvidenceProvider (chainEvidence(providers)) and it cites whatever the chain returns
// — exactly today's behavior, which is what the router must beat (Req 8.4). Reuses
// the existing chain unchanged; no new evidence service (Req 2.6, non-goals).
export function makeCurrentChainStrategy(evidence: EvidenceProvider): Strategy {
  return {
    name: 'current_chain',
    async citeUrls(claimText: string) {
      const { citations } = await evidence.gather(claimText);
      return citations.map((c) => c.sourceUrl);
    },
  };
}

export interface RouterStrategyDeps {
  normalizer: ClaimNormalizer;
  validator: CandidateValidator;
  sources: RetrievalSource[];
  classifyTier: (sourceUrl: string) => SourceTier; // classifyCitationTier
  perVariantCap?: number;
}

// `router`: the precision strategy, composed from the existing router stages
// (normalize → triage → query pack → retrieve → validate → route). It cites ONLY
// ledger evidence (same_claim / contradictory_but_relevant, tier ≠ excluded), which
// is the whole point — near-misses and context never become citations.
//
// ponytail: this composes the shipped router pieces directly rather than calling the
// orchestrator. Once `verifyClaim` (task 8.1) lands, the router strategy should
// delegate to it so the benchmark measures the exact production path; until then this
// reuses the same gating/routing logic the orchestrator will, so the measured FER is
// faithful. Ceiling: a second assembly site to keep in step with verifyClaim; upgrade
// path is a one-line swap to `(await verifyClaim(text, deps)).citations`.
export function makeRouterStrategy(deps: RouterStrategyDeps): Strategy {
  const retrieve = makeRetrieve({
    sources: deps.sources,
    classifyTier: deps.classifyTier,
    perVariantCap: deps.perVariantCap,
  });

  return {
    name: 'router',
    async citeUrls(claimText: string) {
      const normalized = await deps.normalizer.normalize(claimText);
      // Triage short-circuit: a not_fact_checkable claim is never searched (Req 1.5)
      // and therefore cites nothing.
      if (!triage(normalized)) return [];

      const variants = QueryPackGenerator.generate(normalized.canonicalClaim);

      // Collect candidates across every variant. A variant whose retrieval throws
      // contributes zero candidates (design error handling), never failing the run.
      const candidates = [];
      for (const variant of variants) {
        try {
          candidates.push(...(await retrieve(variant)));
        } catch {
          // zero candidates for this variant
        }
      }

      // Validate each candidate against the ORIGINAL claim text (Req 3.2), then route.
      const validated: ValidatedCandidate[] = [];
      for (const candidate of candidates) {
        const v = await safeValidate(deps.validator, claimText, candidate);
        validated.push({
          candidate,
          matchType: v.matchType,
          matchConfidence: v.matchConfidence,
          selectedAsEvidence: false, // routeCandidates sets this from the gates
        });
      }

      return routeCandidates(validated).citations.map((c) => c.sourceUrl);
    },
  };
}

// ponytail: one runnable self-check (run `node --import tsx src/router/benchmark/runner.ts`).
// Full property coverage is tasks 12.3–12.5; this only fails fast if FER, the
// Ship_Gate, or the extraction-held-constant guarantee regress. Uses synthetic claims
// and stub strategies so it stays dependency-free and offline. The block uses
// top-level await (ESM) for runBenchmark; it runs only when invoked directly.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const mk = (id: string): BenchmarkClaim => ({
    id,
    originalClaim: `claim ${id}`,
    sourceKind: 'article',
    language: 'en',
    category: 'mundane_factual',
    idealOutcome: 'no_sufficient_evidence',
    acceptableUrls: [`https://good.example/${id}`],
    unacceptableUrls: [`https://bad.example/${id}`],
  });
  const claims = [mk('a'), mk('b'), mk('c'), mk('d')];

  // FER (Req 8.3): a cited-good URL is not false; a cited-bad or absent URL is; no
  // citation is not false. Two of four claims cite false evidence here → 0.5.
  const entries: ClaimCitations[] = [
    { claim: claims[0]!, citedUrls: ['https://good.example/a'] }, // acceptable → not false
    { claim: claims[1]!, citedUrls: ['https://bad.example/b'] }, // unacceptable → false
    { claim: claims[2]!, citedUrls: ['https://unknown.example/x'] }, // absent → false
    { claim: claims[3]!, citedUrls: [] }, // no citation → not false
  ];
  assert.equal(falseEvidenceRate(entries), 0.5);
  assert.equal(falseEvidenceRate([]), 0); // empty set is rate 0
  assert.ok(falseEvidenceRate(entries) >= 0 && falseEvidenceRate(entries) <= 1); // Property 14 range

  // Ship_Gate (Req 8.4): lower approves, tie approves, higher rejects.
  assert.equal(shipGate(0.2, 0.3), true);
  assert.equal(shipGate(0.3, 0.3), true);
  assert.equal(shipGate(0.4, 0.3), false);

  // Extraction held constant (Req 8.6): both strategies see identical claim text,
  // claim for claim. Spy strategies record what they were fed.
  const seenByCurrent: string[] = [];
  const seenByRouter: string[] = [];
  const currentSpy: Strategy = {
    name: 'current_chain',
    async citeUrls(t) {
      seenByCurrent.push(t);
      return [t.includes('a') ? 'https://bad.example/a' : 'https://good.example/b'];
    },
  };
  const routerSpy: Strategy = {
    name: 'router',
    async citeUrls(t) {
      seenByRouter.push(t);
      return []; // honest none → zero false evidence
    },
  };

  const report = await runBenchmark(claims, [currentSpy, routerSpy]);
  assert.deepEqual(seenByCurrent, seenByRouter); // identical claim text, claim for claim
  assert.deepEqual(
    seenByCurrent,
    claims.map((c) => c.originalClaim),
  ); // exactly the pre-extracted texts

  const routerFer = report.results.find((r) => r.strategy === 'router')!.falseEvidenceRate;
  const currentFer = report.results.find((r) => r.strategy === 'current_chain')!.falseEvidenceRate;
  assert.equal(routerFer, 0); // cited nothing → no false evidence
  assert.ok(currentFer > 0); // cited a bad/absent URL for at least one claim
  assert.equal(report.approved, true); // router (0) ≤ current → ship

  console.log('runner.ts self-check passed');
}
