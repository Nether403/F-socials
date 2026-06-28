// Feature: parallel-evidence-lookups, Property 2: Error isolation reproduces serial defaults
// For ANY extraction and ANY set of injected retrieval failures (any subset of
// variants and/or claims whose retrieve throws), the report produced at cap N is
// deep-structurally equal to the report at cap 1 for the same input and the same
// injected failures: a failing variant contributes exactly zero candidates, remaining
// variants and claims are processed independently and keep their indices, and a claim
// whose every variant fails resolves to no_sufficient_evidence with zero citations.
//
// Validates: Requirements 1.5, 4.1, 4.2, 4.3, 4.4, 4.5
//
// Substrate: deterministic mock providers + in-memory infra (offline, zero network).
// The Serial_Baseline reference is runPipeline(..., cap = 1) (design: cap=1 ⇒ serial).
// Failures are injected through the evidence provider: the pipeline builds its retrieve
// from providers.evidence via makeRetrieve, so a throwing gather() rejects that
// variant's retrieve, which the router isolates to "zero candidates for this variant".
// The fail predicate is a PURE function of the query text, so the IDENTICAL failures
// are reproduced across the cap=1 and cap=N runs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { runPipeline, type PipelineResult } from '../../src/pipeline/stages';
import type { Providers } from '../../src/providers/types';
import type { RawInput } from '../../src/types';

// Deterministic FNV-1a string hash → used to fail a stable subset of query texts.
function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Build a Providers set whose evidence.gather THROWS for the query texts selected by
// `shouldFail` (deterministic given the text) and otherwise returns one candidate.
// Everything else is deterministic: a fixed LLM emitting exactly `claims`, a normalizer
// that marks every claim checkable (so each is actually searched), and the seeded
// validator/perspective stand-ins. Pure → safe to call runPipeline twice over it.
function buildProviders(claims: string[], shouldFail: (queryText: string) => boolean): Providers {
  return {
    transcript: {
      async fetch(input: RawInput) {
        return { text: input.transcript ?? '', lang: 'en' };
      },
    },
    llm: {
      async extract() {
        return {
          tldr: 'Error-isolation fixture.',
          issueFrame: { label: 'mixed', x: 0, y: 0 },
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
    // Every claim is checkable, so each is searched (no triage short-circuit) and the
    // injected failures actually exercise the retrieval path.
    normalizer: {
      async normalize(originalClaim: string) {
        return {
          canonicalClaim: originalClaim,
          claimType: 'factual_event' as const,
          factCheckability: 'checkable' as const,
        };
      },
    },
    // The failure-injection point. A throw here rejects the variant's retrieve; the
    // router catches it as zero candidates for that variant (Req 4.2). When EVERY
    // variant of a claim throws, candidates stays empty ⇒ no_sufficient_evidence (4.4).
    evidence: {
      async gather(queryText: string) {
        if (shouldFail(queryText)) {
          throw new Error('injected provider failure');
        }
        return {
          evidenceStrength: 'none' as const,
          citations: [
            {
              sourceUrl: 'https://www.example.org/e',
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
    validator: {
      // Deterministic match keyed off the ORIGINAL claim (Req 3.2). same_claim lets a
      // successfully-retrieved candidate reach the ledger, so non-failing claims carry
      // real citations — the contrast that makes error isolation observable.
      async validate() {
        return { matchType: 'same_claim' as const, matchConfidence: 0.95 };
      },
    },
  };
}

// Strip the fields that were ALREADY non-deterministic in the serial code so the
// deep-structural comparison is over the parts the feature must keep identical:
//   - claims[i].id        — randomUUID(), assigned per claim in stages.ts
//   - audits[i].claimId   — randomUUID() default in buildAuditRecord
//   - audits[i].createdAt — new Date().toISOString() default
function sanitize(report: PipelineResult) {
  return {
    ...report,
    claims: report.claims.map((c) => ({ ...c, id: 'ID' })),
    audits: report.audits.map((a) => ({ ...a, claimId: 'CID', createdAt: 'TS' })),
  };
}

// Generate 1..5 distinct, sentence-like, checkable claims (the index prefix guarantees
// uniqueness and a non-empty Query_Pack for each).
const claimsArb = fc
  .array(
    fc.record({
      subject: fc.constantFrom(
        'unemployment',
        'inflation',
        'the bridge project',
        'the government study',
        'national population',
        'carbon emissions',
        'the vaccine trial',
        'average rainfall',
      ),
      n: fc.integer({ min: 1, max: 99 }),
      year: fc.integer({ min: 1990, max: 2024 }),
    }),
    { minLength: 1, maxLength: 5 },
  )
  .map((rows) =>
    rows.map((r, i) => `Claim ${i}: ${r.subject} changed by ${r.n} percent in ${r.year}.`),
  );

const INPUT: RawInput = { sourceType: 'transcript', transcript: 'ignored by the fixed LLM' };

test('Property 2: parallel ≡ serial under randomly injected retrieval failures', async () => {
  await fc.assert(
    fc.asyncProperty(
      claimsArb,
      fc.integer({ min: 2, max: 8 }), // cap N > 1
      fc.integer({ min: 0, max: 0xffffffff }), // failure salt
      fc.integer({ min: 0, max: 100 }), // failure rate (% of variant queries that throw)
      async (claims, cap, salt, rate) => {
        // Deterministic, text-keyed failure injector reused identically by both runs.
        const shouldFail = (queryText: string) => strHash(`${salt}|${queryText}`) % 100 < rate;

        const serial = await runPipeline(INPUT, buildProviders(claims, shouldFail), 1);
        const parallel = await runPipeline(INPUT, buildProviders(claims, shouldFail), cap);

        // Req 1.5, 4.1, 4.2, 4.3, 4.5: the parallel report is identical to the serial
        // baseline under the same failures — same claims, citations, audits, context,
        // in the same order, each claim at its original extraction index.
        assert.deepEqual(sanitize(parallel), sanitize(serial));
      },
    ),
    { numRuns: 100 },
  );
});

test('Property 2 (degenerate): every variant fails ⇒ no_sufficient_evidence, zero citations', async () => {
  await fc.assert(
    fc.asyncProperty(claimsArb, fc.integer({ min: 2, max: 8 }), async (claims, cap) => {
      const alwaysFail = () => true; // every retrieval throws

      const serial = await runPipeline(INPUT, buildProviders(claims, alwaysFail), 1);
      const parallel = await runPipeline(INPUT, buildProviders(claims, alwaysFail), cap);

      // Still deep-equal to the serial baseline (Req 1.5, 4.1, 4.5).
      assert.deepEqual(sanitize(parallel), sanitize(serial));

      // Req 4.4: a claim whose every Query_Variant fails resolves to
      // no_sufficient_evidence with exactly zero citations — on BOTH paths.
      for (const report of [serial, parallel]) {
        assert.ok(report.claims.length >= 1);
        for (const claim of report.claims) {
          assert.equal(claim.evidenceStrength, 'none', 'all-fail claim must be strength none');
          assert.equal(claim.citations.length, 0, 'all-fail claim must have zero citations');
        }
        for (const audit of report.audits) {
          assert.equal(audit.evidenceOutcome, 'no_sufficient_evidence');
        }
      }
    }),
    { numRuns: 100 },
  );
});
