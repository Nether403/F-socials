// Feature: parallel-evidence-lookups, Property 4: Cost-neutral and complete
// (no dropped, starved, or extra calls).
//
// For any extraction (including claims triage rejects as not_fact_checkable) and any
// concurrency cap N >= 1, with or without injected retrieval failures, the total number
// of Provider_Chain `gather` calls at cap N equals the total at cap 1 for the identical
// input: every scheduled lookup runs exactly once (none dropped or starved), triage-
// rejected claims issue zero calls on both paths, and a failing lookup triggers no extra
// retry call.
//
// Substrate is fully offline: a custom counting EvidenceProvider, the deterministic
// seeded normalizer/validator, and in-process providers — no network, no infra. The
// pipeline wraps providers.evidence into makeRetrieve as a single source, so one gated
// retrieve(variant) == exactly one evidence.gather() call. We run the SAME generated
// input at cap=1 and cap=N with fresh counters and assert the totals are equal.
//
// Validates: Requirements 4.6, 5.2, 5.3, 5.4, 5.5

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { runPipeline } from '../../src/pipeline/stages';
import { mockNormalizer, mockValidator } from '../../src/providers/mock';
import type { Providers } from '../../src/providers/types';
import type { RawInput } from '../../src/types';

const INPUT: RawInput = { sourceType: 'transcript', transcript: 'ignored by the fixed LLM' };

// Deterministic, transform-stable string hash so an injected-failure predicate decides
// identically for the identical query text on both the cap=1 and cap=N paths.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Checkable claims: a statistical/factual_event sentence (a digit forces `statistical`,
// no opinion/rhetorical markers) so the seeded normalizer marks it `checkable` and triage
// proceeds to the Query_Pack — issuing one gather per Query_Variant.
const checkableClaim = fc
  .integer({ min: 1, max: 99999 })
  .map((n) => `A government report recorded ${n} cases in 2021.`);

// not_fact_checkable claims: value judgments the seeded normalizer maps to
// normative_opinion, so triage short-circuits BEFORE any retrieval — zero gather calls.
const opinionClaim = fc.constantFrom(
  'I think this is the best policy ever.',
  'This movie is absolutely overrated.',
  'Pineapple pizza is the worst thing.',
  'I believe everyone should love this.',
);

// A mixed extraction: any blend of checkable and not_fact_checkable claims, so a single
// property run exercises gated lookups (one gather per Query_Variant) and triage short-
// circuits (zero gather calls) together.
const mixedClaims = fc.array(fc.oneof(checkableClaim, opinionClaim), { maxLength: 12 });

// An injected-failure predicate over the query text. `() => false` = no failures; otherwise
// fail whenever hash(text) % m === 0, which throws inside gather AFTER the call is counted —
// modeling a Provider_Chain submission that fails with no retry.
const failPredicate = fc.oneof(
  fc.constant<(t: string) => boolean>(() => false),
  fc.integer({ min: 1, max: 5 }).map((m) => (t: string) => hashStr(t) % m === 0),
);

// Build offline providers around a fresh call counter. The counting EvidenceProvider
// increments on EVERY gather entry (a real Provider_Chain submission), then optionally
// throws — so a failed lookup is counted exactly once and never retried.
function buildProviders(claims: string[], counter: { n: number }, shouldFail: (t: string) => boolean): Providers {
  return {
    transcript: {
      async fetch(input: RawInput) {
        return { text: input.transcript ?? '', lang: 'en' };
      },
    },
    llm: {
      async extract() {
        return {
          tldr: 'parallel cost fixture',
          issueFrame: { label: 'mixed' as const, x: 0, y: 0 },
          claims: claims.map((claimText) => ({
            claimText,
            transcriptSpan: claimText,
            verifiability: 'verifiable' as const,
            confidence: 0.8,
          })),
          framingSignals: [],
          contextCards: [],
        };
      },
    },
    evidence: {
      async gather(queryText: string) {
        counter.n++; // one Provider_Chain submission
        if (shouldFail(queryText)) throw new Error('injected lookup failure');
        return {
          evidenceStrength: 'none' as const,
          citations: [
            {
              sourceUrl: 'https://www.example.org/a',
              sourceName: 'Example Institution',
              sourceTier: 'tier2_institutional' as const,
              excerpt: `re: ${queryText.slice(0, 40)}`,
              supports: null,
            },
          ],
        };
      },
    },
    perspective: {
      async find() {
        return [];
      },
    },
    normalizer: mockNormalizer, // seeded, deterministic triage behavior
    validator: mockValidator,
  };
}

async function countGatherCalls(
  claims: string[],
  cap: number,
  shouldFail: (t: string) => boolean,
): Promise<number> {
  const counter = { n: 0 };
  await runPipeline(INPUT, buildProviders(claims, counter, shouldFail), cap);
  return counter.n;
}

test('Property 4: gather-call count is cap-invariant, incl. failures (calls(cap=1) === calls(cap=N))', async () => {
  await fc.assert(
    fc.asyncProperty(mixedClaims, fc.integer({ min: 2, max: 8 }), failPredicate, async (claims, n, shouldFail) => {
      const callsAtCap1 = await countGatherCalls(claims, 1, shouldFail);
      const callsAtCapN = await countGatherCalls(claims, n, shouldFail);
      // No dropped, starved, duplicated, or retried calls under parallelism or failures.
      assert.equal(callsAtCapN, callsAtCap1);
    }),
    { numRuns: 100 },
  );
});

test('Property 4: not_fact_checkable claims issue zero gather calls on both the serial and parallel paths', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(opinionClaim, { minLength: 1, maxLength: 8 }),
      fc.integer({ min: 2, max: 8 }),
      async (claims, n) => {
        const callsAtCap1 = await countGatherCalls(claims, 1, () => false);
        const callsAtCapN = await countGatherCalls(claims, n, () => false);
        // Triage short-circuits before any retrieval, so neither path touches the provider.
        assert.equal(callsAtCap1, 0);
        assert.equal(callsAtCapN, 0);
      },
    ),
    { numRuns: 100 },
  );
});
