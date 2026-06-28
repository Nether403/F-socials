// Feature: parallel-evidence-lookups, Property 7: p95 latency reporting is correct
// Validates: Requirements 7.3
//
// For any non-empty sample of per-run latencies and any threshold, runLatencyBenchmark
// SHALL expose the per-run latencies, a nearest-rank 95th-percentile value computed
// from them, and a `passed` flag equal to (p95 <= threshold). We drive the harness
// with an injected, fully deterministic fake clock so each run's measured latency is a
// value we control, then independently recompute the nearest-rank p95 (NOT importing
// `percentile`, so this is a true cross-check of the production aggregation) and assert
// the report matches. The threshold range straddles the p95 so `passed` flips both ways.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { runLatencyBenchmark } from '../../src/router/benchmark/runner';

// Independent nearest-rank p95 (design "Benchmark p95 reporting"): sort ascending,
// rank = ceil(p/100 * n) clamped to [1, n], value at 1-based rank (0-based rank-1).
function nearestRankP95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const rank = Math.ceil((95 / 100) * n);
  const idx = Math.min(Math.max(rank, 1), n) - 1;
  return sorted[idx]!;
}

// Build a deterministic clock from intended per-run latencies. runLatencyBenchmark
// reads the clock twice per run (start, end) and records end - start, so we lay out
// 2*n monotonically increasing timestamps where run i spans [base_i, base_i + samples[i]].
// The measured delta for run i is therefore exactly samples[i], with no real time.
function clockFor(samples: number[]): () => number {
  const times: number[] = [];
  let base = 0;
  for (const s of samples) {
    times.push(base); // start of this run
    times.push(base + s); // end of this run -> measured latency === s
    base += s + 1; // strictly increasing across runs (gap is irrelevant to the delta)
  }
  let i = 0;
  return () => times[i++]!;
}

test('Property 7: p95 latency reporting is correct', async () => {
  await fc.assert(
    fc.asyncProperty(
      // runs is floored at 20 inside runLatencyBenchmark, so supply >= 20 sample deltas
      // and set runs = samples.length to control every run's latency exactly.
      fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 20, maxLength: 60 }),
      fc.integer({ min: 0, max: 150 }), // straddles the p95 -> passed flips both ways
      async (samples, thresholdMs) => {
        const report = await runLatencyBenchmark(async () => {}, {
          runs: samples.length,
          thresholdMs,
          now: clockFor(samples),
        });

        // Exposes the per-run latencies, in run order, exactly as measured.
        assert.deepEqual(report.latenciesMs, samples);

        // p95 is the nearest-rank 95th percentile computed from those latencies.
        const expectedP95 = nearestRankP95(samples);
        assert.equal(report.p95Ms, expectedP95);

        // Threshold is carried through, and passed === (p95 <= threshold).
        assert.equal(report.thresholdMs, thresholdMs);
        assert.equal(report.passed, expectedP95 <= thresholdMs);
      },
    ),
    { numRuns: 100 },
  );
});
