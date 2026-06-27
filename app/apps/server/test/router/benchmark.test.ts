// Feature: claim-verification-router, Property 14: False_Evidence_Rate is computed correctly
// For any labeled benchmark set and any assignment of cited URLs to those claims,
// the reported False_Evidence_Rate (falseEvidenceRate over ClaimCitations) lies in
// the inclusive range 0 to 1 and equals the fraction of claims that cited at least
// one URL absent from that claim's acceptable set (or present in its unacceptable
// set) — the False_Evidence rule encoded by isFalseEvidenceUrl.
// Validates: Requirements 8.3

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  falseEvidenceRate,
  isFalseEvidenceUrl,
  type BenchmarkClaim,
  type ClaimCitations,
} from '../../src/router/benchmark/runner';

// A small shared URL pool so acceptable / unacceptable / cited sets overlap by
// construction: every generated assignment hits all branches of the false-evidence
// rule — cited-and-acceptable (not false), cited-and-unacceptable (false),
// cited-and-unknown/absent (false), and cited-nothing (not false).
const URL_POOL = [
  'https://example.org/a',
  'https://example.org/b',
  'https://example.org/c',
  'https://example.org/d',
  'https://example.org/e',
  'https://example.org/unknown',
];
const urlArb = fc.constantFrom(...URL_POOL);

// Only the acceptable/unacceptable/cited URLs drive the FER; the rest of the
// BenchmarkClaim is filled with valid constant values so each entry is a fully
// well-formed ClaimCitations the runner would actually score.
const claimCitationsArb: fc.Arbitrary<ClaimCitations> = fc
  .record({
    acceptableUrls: fc.uniqueArray(urlArb, { maxLength: 4 }),
    unacceptableUrls: fc.uniqueArray(urlArb, { maxLength: 4 }),
    citedUrls: fc.array(urlArb, { maxLength: 5 }),
  })
  .map(({ acceptableUrls, unacceptableUrls, citedUrls }): ClaimCitations => {
    const claim: BenchmarkClaim = {
      id: 'c',
      originalClaim: 'a pre-extracted claim',
      sourceKind: 'article',
      language: 'en',
      category: 'mundane_factual',
      idealOutcome: 'no_sufficient_evidence',
      acceptableUrls,
      unacceptableUrls,
    };
    return { claim, citedUrls };
  });

// Include the empty benchmark set (rate 0, no false citations possible) in the input
// space alongside non-empty sets.
const entriesArb = fc.array(claimCitationsArb, { maxLength: 12 });

test('Property 14: False_Evidence_Rate is computed correctly', () => {
  fc.assert(
    fc.property(entriesArb, (entries) => {
      const rate = falseEvidenceRate(entries);

      // Range: always within [0, 1] inclusive.
      assert.ok(rate >= 0 && rate <= 1, `FER out of range: ${rate}`);

      // Value: equals the fraction of claims that cited at least one false-evidence
      // URL — a cited URL absent from the acceptable set OR present in the
      // unacceptable set. Computed here independently of falseEvidenceRate's own
      // counting loop, matching the False_Evidence rule directly.
      const falseClaims = entries.filter((e) =>
        e.citedUrls.some(
          (url) =>
            e.claim.unacceptableUrls.includes(url) ||
            !e.claim.acceptableUrls.includes(url),
        ),
      ).length;
      const expected = entries.length === 0 ? 0 : falseClaims / entries.length;

      assert.equal(rate, expected);

      // The per-URL rule the rate is built on agrees with the same definition.
      for (const e of entries) {
        for (const url of e.citedUrls) {
          const expectedFalse =
            e.claim.unacceptableUrls.includes(url) ||
            !e.claim.acceptableUrls.includes(url);
          assert.equal(isFalseEvidenceUrl(e.claim, url), expectedFalse);
        }
      }
    }),
    { numRuns: 100 },
  );
});

// Feature: claim-verification-router, Property 15: The Ship_Gate approves only a non-worse strategy
// For any pair of rates (ferRouter, ferCurrent) in [0,1], the Ship_Gate (shipGate)
// approves adoption of the router if and only if ferRouter <= ferCurrent — a lower
// rate ships, a tie ships (a tie on the governing metric is not a regression), and a
// higher rate is rejected.
// Validates: Requirements 8.4

import { shipGate } from '../../src/router/benchmark/runner';

// Rates are False_Evidence_Rates, always in [0,1] inclusive. Generate the full range
// including the boundaries 0 and 1.
const rateArb = fc.double({ min: 0, max: 1, noNaN: true });

test('Property 15: The Ship_Gate approves only a non-worse strategy', () => {
  // Arbitrary independent pairs — covers strictly-lower, strictly-higher, and (rarely)
  // equal rates across the input space.
  fc.assert(
    fc.property(rateArb, rateArb, (ferRouter, ferCurrent) => {
      assert.equal(shipGate(ferRouter, ferCurrent), ferRouter <= ferCurrent);
    }),
    { numRuns: 100 },
  );

  // Equal pairs are the boundary the iff must get right: a tie always approves.
  // Drive them explicitly so ties are exercised regardless of generator luck.
  fc.assert(
    fc.property(rateArb, (fer) => {
      assert.equal(shipGate(fer, fer), true);
    }),
    { numRuns: 100 },
  );
});

// Feature: claim-verification-router, Property 16: The Benchmark holds the extraction model constant
// For any benchmark run, the claim text supplied to the current_chain strategy is
// identical, claim for claim, to the claim text supplied to the router strategy.
// Both strategies are fed the same pre-extracted originalClaim verbatim and in order,
// so the extraction-model confound cannot distort the comparison.
// Validates: Requirements 8.6

import { runBenchmark, type Strategy } from '../../src/router/benchmark/runner';

// Arbitrary BenchmarkClaim varying ONLY originalClaim — that is the value whose
// claim-for-claim identity across strategies is under test. Every other field is a
// valid constant so each claim is a well-formed entry the runner would actually feed.
const benchmarkClaimArb: fc.Arbitrary<BenchmarkClaim> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    originalClaim: fc.string(),
  })
  .map(({ id, originalClaim }): BenchmarkClaim => ({
    id,
    originalClaim,
    sourceKind: 'article',
    language: 'en',
    category: 'mundane_factual',
    idealOutcome: 'no_sufficient_evidence',
    acceptableUrls: [],
    unacceptableUrls: [],
  }));

// Include the empty benchmark (nothing fed to either strategy) alongside non-empty runs.
const claimsArb = fc.array(benchmarkClaimArb, { maxLength: 12 });

test('Property 16: The Benchmark holds the extraction model constant', async () => {
  await fc.assert(
    fc.asyncProperty(claimsArb, async (claims) => {
      // Two spy strategies that record every claimText they receive, in order. They
      // cite nothing — the citations are irrelevant here; the input text is the subject.
      const seenByCurrent: string[] = [];
      const seenByRouter: string[] = [];
      const currentSpy: Strategy = {
        name: 'current_chain',
        async citeUrls(text) {
          seenByCurrent.push(text);
          return [];
        },
      };
      const routerSpy: Strategy = {
        name: 'router',
        async citeUrls(text) {
          seenByRouter.push(text);
          return [];
        },
      };

      await runBenchmark(claims, [currentSpy, routerSpy]);

      const expected = claims.map((c) => c.originalClaim);
      // Identical claim text, claim for claim, to both strategies...
      assert.deepEqual(seenByCurrent, seenByRouter);
      // ...and exactly the pre-extracted originalClaim values, in order.
      assert.deepEqual(seenByCurrent, expected);
      assert.deepEqual(seenByRouter, expected);
    }),
    { numRuns: 100 },
  );
});

// Smoke test: benchmark fixture composition (task 12.6)
// Asserts the offline Benchmark dataset (src/router/benchmark/fixtures.json) is the
// shape the False_Evidence_Rate / Ship_Gate machinery and Requirements 8.1/8.2 demand:
// approximately 100 labeled claims spanning the required source kinds, languages, and
// claim categories, each carrying exactly one valid idealOutcome and both URL lists.
// This is a fixed-data smoke test (no fast-check) — it guards the dataset itself, the
// raw material every benchmark run scores over.
// Validates: Requirements 8.1, 8.2

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EvidenceOutcome } from '../../src/types';

// Load the fixtures the same way the runner would offline: read the JSON next to the
// runner relative to this test file (the project uses moduleResolution "Bundler"
// without resolveJsonModule, so a runtime read is the faithful, dependency-free path).
const fixturesUrl = new URL('../../src/router/benchmark/fixtures.json', import.meta.url);
const fixtures = JSON.parse(readFileSync(fileURLToPath(fixturesUrl), 'utf8')) as BenchmarkClaim[];

const VALID_OUTCOMES: ReadonlySet<EvidenceOutcome> = new Set<EvidenceOutcome>([
  'matched_fact_check',
  'matched_primary_source',
  'matched_institutional_source',
  'relevant_context_only',
  'no_sufficient_evidence',
  'not_fact_checkable',
]);

test('Smoke: fixtures.json holds ~100 well-formed labeled claims', () => {
  // Approximately 100 claims (Req 8.1, 8.2). A lower bound guards against a truncated
  // or stub dataset while staying consistent with what task 12.1 produced (~92); the
  // upper bound keeps "approximately 100" honest.
  assert.ok(
    fixtures.length >= 80 && fixtures.length <= 130,
    `expected ~100 benchmark claims, got ${fixtures.length}`,
  );

  // Distinct ids — a benchmark with duplicate ids would double-count claims.
  const ids = new Set(fixtures.map((c) => c.id));
  assert.equal(ids.size, fixtures.length, 'benchmark claim ids must be unique');

  for (const claim of fixtures) {
    // Identity + non-empty pre-extracted claim text (the text fed verbatim to every
    // strategy, Req 8.6).
    assert.ok(typeof claim.id === 'string' && claim.id.length > 0, `bad id: ${claim.id}`);
    assert.ok(
      typeof claim.originalClaim === 'string' && claim.originalClaim.trim().length > 0,
      `empty originalClaim for ${claim.id}`,
    );

    // Exactly one valid idealOutcome (Req 8.2).
    assert.ok(
      VALID_OUTCOMES.has(claim.idealOutcome),
      `invalid idealOutcome "${claim.idealOutcome}" for ${claim.id}`,
    );

    // Both URL lists present as arrays of strings (Req 8.2). They may be empty (an
    // honest no-evidence / not-fact-checkable claim has no acceptable source), but the
    // lists must exist so the False_Evidence rule can be evaluated for every claim.
    assert.ok(Array.isArray(claim.acceptableUrls), `acceptableUrls not array for ${claim.id}`);
    assert.ok(Array.isArray(claim.unacceptableUrls), `unacceptableUrls not array for ${claim.id}`);
    for (const url of [...claim.acceptableUrls, ...claim.unacceptableUrls]) {
      assert.ok(typeof url === 'string' && url.length > 0, `bad URL in ${claim.id}: ${url}`);
    }

    // Field-level domain checks for the spanned dimensions.
    assert.ok(['video', 'article'].includes(claim.sourceKind), `bad sourceKind for ${claim.id}`);
    assert.ok(['en', 'nl'].includes(claim.language), `bad language for ${claim.id}`);
    assert.ok(
      ['recent_local', 'known_misinfo', 'mundane_factual', 'other'].includes(claim.category),
      `bad category for ${claim.id}`,
    );
  }

  // Spans the required categories (Req 8.1): at least one of each required sourceKind,
  // language, and claim category is present in the dataset.
  const present = <K extends keyof BenchmarkClaim>(key: K, value: BenchmarkClaim[K]) =>
    fixtures.some((c) => c[key] === value);

  for (const sourceKind of ['video', 'article'] as const) {
    assert.ok(present('sourceKind', sourceKind), `no ${sourceKind} claims in benchmark`);
  }
  for (const language of ['en', 'nl'] as const) {
    assert.ok(present('language', language), `no ${language} claims in benchmark`);
  }
  for (const category of ['recent_local', 'known_misinfo', 'mundane_factual'] as const) {
    assert.ok(present('category', category), `no ${category} claims in benchmark`);
  }
});
