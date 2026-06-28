// Feature: parallel-evidence-lookups, Property 5: Honest-none preserved
// For ANY claim engineered to resolve to the Honest_None_State, the parallel path
// (cap=N) delivers it to the invariant gate with evidenceStrength 'none' and zero
// citations, identically to the serial path (cap=1). Honest-none is a first-class
// valid state — never weakened by parallelization.
// Validates: Requirements 6.3, 8.3

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { runPipeline } from '../../src/pipeline/stages';
import {
  passthroughTranscript,
  mockLLM,
  mockPerspective,
  mockNormalizer,
  mockValidator,
} from '../../src/providers/mock';
import type { EvidenceProvider, Providers } from '../../src/providers/types';
import type { Claim, RawInput } from '../../src/types';

// Engineer the Honest_None_State by construction: an EvidenceProvider that returns NO
// citations for any query. Every Query_Variant therefore yields zero candidates, so a
// checkable claim resolves to `no_sufficient_evidence` (strength 'none', 0 citations)
// and an opinion short-circuits via triage to `not_fact_checkable` (also 'none', 0) —
// both are the honest-none outcome that must reach the gate intact. Offline + network
// free: gather never touches an external endpoint (Req 8.5).
const noEvidence: EvidenceProvider = {
  async gather() {
    return { evidenceStrength: 'none' as const, citations: [] };
  },
};

// Reuse the deterministic offline mocks for every non-evidence provider (the mockLLM
// extracts claims from transcript sentences); only `evidence` is swapped for the
// honest-none substrate.
function buildProviders(): Providers {
  return {
    transcript: passthroughTranscript,
    llm: mockLLM,
    evidence: noEvidence,
    perspective: mockPerspective,
    normalizer: mockNormalizer,
    validator: mockValidator,
  };
}

// A sentence is a few words drawn from a mix of factual-signal tokens (data/study/
// percent/rate force the mockLLM to mark a claim verifiable) and plain words, so the
// generated transcript yields a spread of checkable and not-checkable claims — every
// one of which must still land on honest-none. Joined with ". " so the mockLLM's
// sentence splitter recovers each as its own claim (it keeps the first 5).
const sentenceArb = fc
  .array(
    fc.constantFrom(
      'the', 'rate', 'study', 'data', 'percent', 'report', 'fox', 'jumps',
      'over', 'lazy', 'always', 'never', 'growth', 'market', 'people',
    ),
    { minLength: 2, maxLength: 6 },
  )
  .map((ws) => ws.join(' '));

const transcriptArb = fc
  .array(sentenceArb, { minLength: 1, maxLength: 8 })
  .map((ss) => ss.map((s) => `${s}.`).join(' '));

// Compare claims excluding the per-claim `randomUUID` id, which is non-deterministic
// in BOTH the serial and parallel code (it was already non-deterministic), so it is
// the one field excluded from the output-equivalence comparison.
function stripIds(claims: Claim[]): Omit<Claim, 'id'>[] {
  return claims.map(({ id: _id, ...rest }) => rest);
}

test("Property 5: honest-none claims reach the gate as 'none'/0 citations, identical serial vs parallel", async () => {
  await fc.assert(
    fc.asyncProperty(transcriptArb, fc.integer({ min: 2, max: 8 }), async (transcript, n) => {
      const input: RawInput = { sourceType: 'transcript', transcript };

      // cap=1 is the Serial_Baseline; cap=N (2..8) is the parallel path.
      const serial = await runPipeline(input, buildProviders(), 1);
      const parallel = await runPipeline(input, buildProviders(), n);

      // We engineered claims to exist (≥1) so the property is non-vacuous.
      assert.ok(serial.claims.length >= 1, 'expected at least one engineered claim');

      // Every claim, on BOTH paths, is the Honest_None_State: 'none' strength + zero
      // citations reaching the invariant gate (Req 6.3, 8.3).
      for (const c of [...serial.claims, ...parallel.claims]) {
        assert.equal(c.evidenceStrength, 'none', `claim "${c.claimText}" must be 'none'`);
        assert.equal(c.citations.length, 0, `claim "${c.claimText}" must have zero citations`);
      }

      // The parallel path produces the identical honest-none claims (deep-equal,
      // excluding only the non-deterministic id) in identical extraction order.
      assert.deepEqual(stripIds(parallel.claims), stripIds(serial.claims));

      // The honest-none state reaches the gate intact: same status + reasons as serial.
      assert.equal(parallel.status, serial.status);
      assert.deepEqual(parallel.reasons, serial.reasons);
    }),
    { numRuns: 100 },
  );
});
