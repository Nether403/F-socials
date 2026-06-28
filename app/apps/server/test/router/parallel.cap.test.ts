// Feature: parallel-evidence-lookups, Property 3: In-flight submissions never exceed
// the cap — for any extraction and any cap N >= 1, when every gated retrieve is
// instrumented to increment a counter on entry and decrement on exit, the maximum
// observed in-flight count over the whole report is at most N, and exactly 1 when N = 1
// (the serial baseline).
//
// Validates: Requirements 1.3, 2.5, 5.1
//
// How the counter measures what the requirement is about: runPipeline wires a SINGLE
// evidence source into makeRetrieve (src/pipeline/stages.ts), so one gated retrieve call
// invokes evidence.gather exactly once (src/router/retrieve.ts). The Bounded_Scheduler
// (the shared Semaphore) wraps each retrieve, so the count of concurrently in-flight
// gather calls equals the count of held semaphore slots — i.e. the in-flight
// Provider_Chain submissions the cap is meant to bound. Each gather yields on a real
// timer so overlap is actually observable rather than collapsing to one-at-a-time.
//
// Offline substrate: deterministic mock providers (passthrough transcript, mockLLM,
// mockPerspective, mockNormalizer, mockValidator) + in-memory; only evidence.gather is
// swapped for the instrumented counter. No outbound network (Req 8.5).

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

// A factual sentence with a digit and a "study/report/data" keyword: classified
// `statistical` by the normalizer (so it is checkable and IS searched — every variant
// becomes a gated retrieve), carries no opinion word and no trailing '?', so triage
// never short-circuits it. Generating >= 2 of these guarantees multiple checkable
// claims with checkable variants, so cap > 1 actually has lookups to overlap.
const NOUNS = ['bridge', 'committee', 'survey', 'budget', 'census', 'index', 'panel', 'agency'] as const;
const sentenceArb = fc
  .tuple(fc.constantFrom(...NOUNS), fc.integer({ min: 1, max: 99 }), fc.integer({ min: 1900, max: 2024 }))
  .map(([noun, n, year]) => `The ${noun} report measured ${n} units in ${year}`);

// mockLLM takes the first 5 sentences as claims; 2..5 sentences => >= 2 checkable claims.
const transcriptArb = fc
  .array(sentenceArb, { minLength: 2, maxLength: 5 })
  .map((sentences) => sentences.join('. ') + '.');

// Cap across the full range exercised by the suite: 1 (serial) through 8.
const capArb = fc.integer({ min: 1, max: 8 });

test('Property 3: max in-flight provider submissions never exceeds the cap', async () => {
  await fc.assert(
    fc.asyncProperty(transcriptArb, capArb, async (transcript, cap) => {
      let inFlight = 0;
      let maxInFlight = 0;
      let calls = 0;

      // One gather = one gated Provider_Chain submission. Increment on entry, record the
      // peak, yield on a real timer (so siblings admitted under the cap actually overlap
      // here), then decrement on exit.
      const instrumentedEvidence: EvidenceProvider = {
        async gather(claimText: string) {
          calls++;
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 1));
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
        evidence: instrumentedEvidence,
        perspective: mockPerspective,
        normalizer: mockNormalizer,
        validator: mockValidator,
      };

      const input: RawInput = { sourceType: 'transcript', transcript };
      await runPipeline(input, providers, cap);

      // Req 1.3 / 5.1: at every instant the number of in-flight Provider_Chain
      // submissions stays at or below the effective cap.
      assert.ok(
        maxInFlight <= cap,
        `maxInFlight ${maxInFlight} exceeded cap ${cap} (calls=${calls}, transcript=${JSON.stringify(transcript)})`,
      );

      // Req 2.5: cap = 1 reproduces the serial baseline — never two in flight, and
      // exactly one whenever any lookup ran (0 only if the report issued no lookups).
      if (cap === 1) {
        assert.equal(
          maxInFlight,
          calls > 0 ? 1 : 0,
          `cap=1 must serialize: expected ${calls > 0 ? 1 : 0} in-flight, saw ${maxInFlight}`,
        );
      }
    }),
    { numRuns: 100 },
  );
});
