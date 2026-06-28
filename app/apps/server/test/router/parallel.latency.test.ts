// Feature: parallel-evidence-lookups, Property 6: Latency reduction under bounded
// parallelism — for any report with at least two independent checkable claims, when
// retrieval uses deterministic mock providers with a fixed identical per-lookup latency
// and the cap N satisfies 1 < N <= (number of independent claims), the time to complete
// the report at cap N is strictly less than at cap 1 (the Serial_Baseline), and the
// maximum observed in-flight retrieve count at cap N is greater than 1.
//
// Validates: Requirements 1.1, 1.2, 7.2
//
// How the measurement works (deterministic logical clock, not wall-clock): runPipeline
// wires a SINGLE evidence source into makeRetrieve, so one gated retrieve = one
// evidence.gather call (src/router/retrieve.ts), and the shared Semaphore bounds how many
// gathers run at once. Instead of each gather sleeping a real `setTimeout` (whose duration
// a loaded box stretches unpredictably, so two sequential wall-clock runs could invert),
// every gather costs exactly ONE logical "wave": all gathers the Semaphore has admitted at
// a given instant register on the current wave and are released together on the next
// `setImmediate` macrotask; the freed permits then admit the next batch, forming the next
// wave. `setImmediate` ordering is FIFO and independent of wall-clock duration, so the wave
// count is identical no matter how loaded the machine is.
//
// That wave count IS the critical-path length the requirement is about:
//   - cap=1 (Serial_Baseline): the Semaphore admits one gather at a time, so each wave
//     holds exactly one lookup => waves == total lookups.
//   - cap=N: up to N admitted gathers share each wave => waves == ceil(total lookups / N),
//     which is strictly fewer than the serial total for any N > 1 (here total lookups is
//     claims x 4 query-variants >= 8, so ceil(.../N) is always < the serial total).
// The strict-less assertion therefore holds by construction, with no timing noise.
//
// ponytail: the per-lookup "latency" is now a logical wave rather than real milliseconds,
// so the test is both deterministic AND fast (no real sleeps). The in-flight peak is still
// instrumented from real overlap so cap=N is shown to actually run lookups concurrently.
//
// Offline substrate (Req 8.5): deterministic mock providers (passthrough transcript,
// mockLLM, mockPerspective, mockNormalizer, mockValidator) + in-memory; only evidence.gather
// is swapped for the wave-clocked, in-flight-instrumented stand-in. No outbound network.

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
import type { RawInput } from '../../src/types';

// A factual sentence with a digit and a "report" keyword: classified checkable by the
// normalizer (so it IS searched — every Query_Variant becomes a gated retrieve), carries
// no opinion word and no trailing '?', so triage never short-circuits it. This is the
// same proven-searched sentence shape used by parallel.cap.test.ts.
const NOUNS = ['bridge', 'committee', 'survey', 'budget', 'census', 'index', 'panel', 'agency'] as const;
const sentenceArb = fc
  .tuple(fc.constantFrom(...NOUNS), fc.integer({ min: 1, max: 99 }), fc.integer({ min: 1900, max: 2024 }))
  .map(([noun, n, year]) => `The ${noun} report measured ${n} units in ${year}`);

// 2..3 checkable claims (mockLLM takes the first 5 sentences as claims), guaranteeing
// >= 2 independent claims to overlap. Pair each scenario with a cap N drawn from
// 2..claimCount, satisfying 1 < N <= (number of independent claims).
const scenarioArb = fc
  .array(sentenceArb, { minLength: 2, maxLength: 3 })
  .chain((sentences) =>
    fc.integer({ min: 2, max: sentences.length }).map((cap) => ({ sentences, cap })),
  );

// A wave-clocked evidence provider: each gather costs exactly one logical wave. Every
// gather admitted by the Semaphore registers on the current wave; the next `setImmediate`
// macrotask releases the whole batch and increments the wave count. Reset between runs so
// each run's wave count and in-flight peak are measured in isolation.
function makeWaveClockEvidence() {
  let inFlight = 0;
  let maxInFlight = 0;
  let waves = 0;
  let pending: Array<() => void> = [];
  let scheduled = false;

  // Schedule a single release per wave: the first gather to register schedules the
  // macrotask; later gathers admitted in the same drain just join the batch. (FIFO
  // `setImmediate` ordering is load-independent, unlike a wall-clock sleep.)
  function scheduleRelease(): void {
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      waves++;
      const batch = pending;
      pending = [];
      for (const resolve of batch) resolve();
    });
  }

  const evidence: EvidenceProvider = {
    async gather(claimText: string) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => {
        pending.push(resolve);
        scheduleRelease();
      });
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

  return {
    evidence,
    waves: () => waves,
    maxInFlight: () => maxInFlight,
    reset(): void {
      inFlight = 0;
      maxInFlight = 0;
      waves = 0;
      pending = [];
      scheduled = false;
    },
  };
}

test('Property 6: bounded-parallel report completes in strictly fewer waves than the serial baseline', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async ({ sentences, cap }) => {
      const transcript = sentences.join('. ') + '.';
      const input: RawInput = { sourceType: 'transcript', transcript };

      const clock = makeWaveClockEvidence();
      const providers: Providers = {
        transcript: passthroughTranscript,
        llm: mockLLM,
        evidence: clock.evidence,
        perspective: mockPerspective,
        normalizer: mockNormalizer,
        validator: mockValidator,
      };

      // Serial_Baseline (cap=1): exactly one lookup per wave => waves == total lookups.
      clock.reset();
      await runPipeline(input, providers, 1);
      const serialWaves = clock.waves();

      // Bounded-parallel (cap=N): up to N lookups share each wave => fewer waves. Reset so
      // the in-flight peak and wave count measure the parallel run only.
      clock.reset();
      await runPipeline(input, providers, cap);
      const parallelWaves = clock.waves();
      const maxInFlight = clock.maxInFlight();

      // Req 1.1, 1.2, 7.2: the bounded-parallel run completes in strictly fewer waves
      // (a load-independent proxy for wall-clock time) than the serial baseline.
      assert.ok(
        parallelWaves < serialWaves,
        `expected parallel (cap=${cap}) ${parallelWaves} waves < serial ${serialWaves} waves ` +
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
