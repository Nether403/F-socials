// Feature: parallel-evidence-lookups, Property 6: Latency reduction under bounded
// parallelism — for any report with at least two independent checkable claims, when
// retrieval uses deterministic mock providers with a fixed identical per-lookup latency
// and the cap N satisfies 1 < N <= (number of independent claims), the wall-clock time to
// complete the report at cap N is strictly less than at cap 1 (the Serial_Baseline), and
// the maximum observed in-flight retrieve count at cap N is greater than 1.
//
// Validates: Requirements 1.1, 1.2, 7.2
//
// How the timing measures what the requirement is about: runPipeline wires a SINGLE
// evidence source into makeRetrieve, so one gated retrieve = one evidence.gather call
// (src/router/retrieve.ts), and the shared Semaphore bounds how many gathers run at once.
// Each gather waits a FIXED 45 ms, so the Serial_Baseline (cap=1) pays that delay once per
// lookup back-to-back (total ~= lookups * 45 ms) while a cap=N run overlaps up to N of them
// (total ~= ceil(lookups / N) * 45 ms). With >= 2 checkable claims (each expanding to a
// 4-variant Query_Pack => >= 8 gated lookups) and a generous 45 ms delay, the serial total
// dwarfs the bounded-parallel total by a wide margin, so strict-less holds comfortably.
//
// ponytail ceiling: wall-clock is inherently noisy and a pathologically loaded box could
// still flake; the delay is kept generous (45 ms) and few claims are used so the gap is
// large, and the assertion is strict-less (not a ratio). Upgrade path if it ever flakes is
// a logical-clock fake-timer harness.
//
// Offline substrate (Req 8.5): deterministic mock providers (passthrough transcript,
// mockLLM, mockPerspective, mockNormalizer, mockValidator) + in-memory; only evidence.gather
// is swapped for the fixed-delay, in-flight-instrumented stand-in. No outbound network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
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
import type { RawInput } from '../../src/types';

// Generous fixed per-lookup delay (design Testing Strategy P6): big enough that the serial
// total clearly dwarfs the bounded-parallel total, so the strict-less margin is wide.
const PER_LOOKUP_DELAY_MS = 45;

// A factual sentence with a digit and a "report" keyword: classified checkable by the
// normalizer (so it IS searched — every Query_Variant becomes a gated, delayed retrieve),
// carries no opinion word and no trailing '?', so triage never short-circuits it. This is
// the same proven-searched sentence shape used by parallel.cap.test.ts.
const NOUNS = ['bridge', 'committee', 'survey', 'budget', 'census', 'index', 'panel', 'agency'] as const;
const sentenceArb = fc
  .tuple(fc.constantFrom(...NOUNS), fc.integer({ min: 1, max: 99 }), fc.integer({ min: 1900, max: 2024 }))
  .map(([noun, n, year]) => `The ${noun} report measured ${n} units in ${year}`);

// 2..3 checkable claims (mockLLM takes the first 5 sentences as claims). Few claims keeps
// 100 runs of (serial + parallel) pipelines at 45 ms/lookup within a reasonable wall time
// while still guaranteeing >= 2 independent claims to overlap. Pair each scenario with a
// cap N drawn from 2..claimCount, satisfying 1 < N <= (number of independent claims).
const scenarioArb = fc
  .array(sentenceArb, { minLength: 2, maxLength: 3 })
  .chain((sentences) =>
    fc.integer({ min: 2, max: sentences.length }).map((cap) => ({ sentences, cap })),
  );

test('Property 6: bounded-parallel report completes strictly faster than the serial baseline', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async ({ sentences, cap }) => {
      const transcript = sentences.join('. ') + '.';
      const input: RawInput = { sourceType: 'transcript', transcript };

      let inFlight = 0;
      let maxInFlight = 0;

      // One gather = one gated Provider_Chain submission. Each waits the SAME fixed delay;
      // increment-on-entry / record-peak / decrement-on-exit instruments concurrency so the
      // cap=N run's actual overlap (> 1) is observed rather than assumed.
      const delayedEvidence: EvidenceProvider = {
        async gather(claimText: string) {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, PER_LOOKUP_DELAY_MS));
          inFlight--;
          return {
            evidenceStrength: 'moderate' as const,
            citations: [
              {
                sourceUrl: 'https://example.org/mock-source',
                sourceName: 'Mock Institutional Source',
                sourceTier: 'tier2_institutional' as const,
                excerpt: `re: ${claimText.slice(0, 40)}`,
                supports: null,
              },
            ],
          };
        },
      };

      const providers: Providers = {
        transcript: passthroughTranscript,
        llm: mockLLM,
        evidence: delayedEvidence,
        perspective: mockPerspective,
        normalizer: mockNormalizer,
        validator: mockValidator,
      };

      // Serial_Baseline (cap=1): exactly one lookup in flight at a time, delays paid serially.
      const serialStart = performance.now();
      await runPipeline(input, providers, 1);
      const serialMs = performance.now() - serialStart;

      // Bounded-parallel (cap=N): up to N lookups overlap. Reset the in-flight peak so it
      // measures the parallel run only.
      inFlight = 0;
      maxInFlight = 0;
      const parallelStart = performance.now();
      await runPipeline(input, providers, cap);
      const parallelMs = performance.now() - parallelStart;

      // Req 1.1, 1.2, 7.2: the bounded-parallel run completes in strictly less wall-clock
      // time than the serial baseline for the same input.
      assert.ok(
        parallelMs < serialMs,
        `expected parallel (cap=${cap}) ${parallelMs.toFixed(1)}ms < serial ${serialMs.toFixed(1)}ms ` +
          `(claims=${sentences.length}, transcript=${JSON.stringify(transcript)})`,
      );

      // Req 1.1, 1.2: the cap=N run actually overlaps lookups — a later lookup began before
      // a prior one completed, so more than one was in flight at some instant.
      assert.ok(
        maxInFlight > 1,
        `expected max in-flight > 1 at cap=${cap}, saw ${maxInFlight} (claims=${sentences.length})`,
      );
    }),
    { numRuns: 100 },
  );
});
