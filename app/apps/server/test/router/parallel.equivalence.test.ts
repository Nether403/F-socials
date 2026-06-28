// Feature: parallel-evidence-lookups, Property 1: Output-equivalence (parallel ≡ serial)
// For ANY extraction (claims, framing signals, context cards) and any deterministic
// provider set, and for ANY concurrency cap N ≥ 1, the report produced by runPipeline at
// cap N is deep-structurally equal to the report at cap 1 (the Serial_Baseline) — equal in
// status, reasons (same elements, same order), claim order, each claim's evidenceStrength
// and citation content/order, audit content/order (audit at index i describing claim i),
// useful-context order (grouped by claim index ascending, in-group order preserved), and
// context-card order — excluding only the fields that were ALREADY non-deterministic in the
// serial code: the per-claim randomUUID ids (claim.id and audit.claimId) and the audit
// createdAt timestamp. The cap=1 run is the Serial_Baseline by Req 2.5 (cap=1 ⇒ exactly one
// provider submission in flight, in extraction-then-variant order).
//
// Validates: Requirements 1.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.2, 6.4, 6.5, 6.6, 8.2

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { runPipeline, type PipelineResult } from '../../src/pipeline/stages';
import {
  passthroughTranscript,
  mockLLM,
  mockEvidence,
  mockPerspective,
  mockNormalizer,
  mockValidator,
} from '../../src/providers/mock';
import type { Providers } from '../../src/providers/types';
import type { RawInput } from '../../src/types';

// Offline, in-memory, zero-API-key substrate (Req 8.2, 8.5): the seeded deterministic
// mocks. mockNormalizer/mockValidator are the seeded router stages, mockEvidence/mockLLM
// are pure functions of their input — so the whole pipeline is deterministic given the
// transcript, and the only non-determinism is the pre-existing randomUUID ids + audit
// timestamp, which sanitize() strips below. All mocks are stateless, so one shared
// Providers object is reused across every run.
const providers: Providers = {
  transcript: passthroughTranscript,
  llm: mockLLM,
  evidence: mockEvidence,
  perspective: mockPerspective,
  normalizer: mockNormalizer,
  validator: mockValidator,
};

// Strip the fields that were already non-deterministic in the serial code so deep-equality
// measures only what parallelization must preserve. claim.id and audit.claimId are
// randomUUID()s; audit.createdAt is a fresh ISO timestamp (buildAuditRecord defaults). The
// property excludes exactly these — every other field is a pure function of the input.
function sanitize(report: PipelineResult): unknown {
  const r = structuredClone(report);
  for (const c of r.claims) delete (c as { id?: string }).id;
  for (const a of r.audits) {
    delete (a as { claimId?: string }).claimId;
    delete (a as { createdAt?: string }).createdAt;
  }
  return r;
}

// Word pool seeded to exercise every extraction branch the mock LLM keys off:
//   - digits / 'percent' / 'study' / 'report' / 'data' ⇒ a 'verifiable' claim (else opinion)
//   - 'always'/'never'/'everyone'/'nobody'/'destroy'/'disaster'/'outrage'/'shocking'/'!!'
//     ⇒ a framing signal (the OUTRAGE regex in mockLLM)
// so random transcripts produce a varied mix of claim verifiability, framing signals, and
// downstream router outcomes (checkable vs not, matched vs honest-none).
const WORDS = [
  'the', 'economy', 'grew', 'study', 'report', 'data', 'government', 'percent', 'people',
  'market', 'rose', 'fell', 'climate', 'policy', 'tax', 'health', 'always', 'never',
  'everyone', 'nobody', 'shocking', 'disaster', 'outrage', '2020', '2021', '30', 'five',
];

const sentenceArb = fc
  .array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 8 })
  .map((words) => words.join(' '));

// A transcript is 0..8 sentences, each closed by a terminator the sentence splitter honors
// ('!!' both terminates and trips the OUTRAGE regex). 0 sentences exercises the empty-input
// path (mockLLM emits the '(empty input)' tldr and zero claims).
const transcriptArb = fc
  .array(fc.tuple(sentenceArb, fc.constantFrom('.', '!', '?', '!!')), {
    minLength: 0,
    maxLength: 8,
  })
  .map((parts) => parts.map(([s, end]) => s + end).join(' '));

test('Property 1: report(cap=N) is deep-equal to report(cap=1) for N in 2..8 (ids/timestamp excluded)', async () => {
  await fc.assert(
    fc.asyncProperty(transcriptArb, fc.integer({ min: 2, max: 8 }), async (transcript, n) => {
      const input: RawInput = { sourceType: 'transcript', transcript };

      // Serial_Baseline (cap=1) vs bounded-parallel (cap=N). Determinism by construction:
      // results are written into pre-sized arrays at each claim's extraction index and each
      // candidate's Query_Variant index, then flattened in index order, so completion order
      // never touches output order.
      const serial = sanitize(await runPipeline(input, providers, 1));
      const parallel = sanitize(await runPipeline(input, providers, n));

      assert.deepEqual(parallel, serial);
    }),
    { numRuns: 100 },
  );
});
