// Feature: intervention-and-scale, Property 1: Trust gate is the strict three-way conjunction over defined metrics
// Feature: intervention-and-scale, Property 2: Per-capability trust thresholds are independent
// Feature: intervention-and-scale, Property 3: Trust gate hot-reloads — verdict always reflects current values
// Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.9, 12.2, 12.3, 12.4, 12.5

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { evaluateTrustGate } from '../src/core/trustGate';
import type { TrustMetrics, TrustThresholds } from '../src/core/trustGate';

// Arbitraries ---

/** A metric value: either a number in [0,1] or undefined. */
const metricArb = fc.oneof(
  { weight: 3, arbitrary: fc.double({ min: 0, max: 1, noNaN: true }) },
  { weight: 1, arbitrary: fc.constant(undefined) },
);

const metricsArb: fc.Arbitrary<TrustMetrics> = fc.record({
  citationCoverage: metricArb,
  modelHumanAgreement: metricArb,
});

const thresholdsArb: fc.Arbitrary<TrustThresholds> = fc.record({
  citationCoverageMin: fc.double({ min: 0, max: 1, noNaN: true }),
  modelHumanAgreementMin: fc.double({ min: 0, max: 1, noNaN: true }),
  legalReviewComplete: fc.boolean(),
});

// Property 1 ---

describe('Property 1: Trust gate is the strict three-way conjunction over defined metrics', () => {
  it('satisfied === true IFF all three conditions hold with strict exceedance', async () => {
    await fc.assert(
      fc.property(metricsArb, thresholdsArb, (metrics, thresholds) => {
        const result = evaluateTrustGate(metrics, thresholds);

        const coverageOk =
          metrics.citationCoverage !== undefined &&
          metrics.citationCoverage > thresholds.citationCoverageMin;

        const agreementOk =
          metrics.modelHumanAgreement !== undefined &&
          metrics.modelHumanAgreement > thresholds.modelHumanAgreementMin;

        const legalOk = thresholds.legalReviewComplete === true;

        const expected = coverageOk && agreementOk && legalOk;

        assert.equal(
          result.satisfied,
          expected,
          `metrics=${JSON.stringify(metrics)}, thresholds=${JSON.stringify(thresholds)}, ` +
            `expected satisfied=${expected}, got=${result.satisfied}, reasons=${JSON.stringify(result.reasons)}`,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('reasons is empty IFF satisfied, non-empty otherwise', async () => {
    await fc.assert(
      fc.property(metricsArb, thresholdsArb, (metrics, thresholds) => {
        const result = evaluateTrustGate(metrics, thresholds);

        if (result.satisfied) {
          assert.equal(result.reasons.length, 0, 'satisfied but reasons non-empty');
        } else {
          assert.ok(result.reasons.length > 0, 'not satisfied but reasons empty');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('never throws for any input', async () => {
    await fc.assert(
      fc.property(metricsArb, thresholdsArb, (metrics, thresholds) => {
        // If this throws, fast-check will catch it as a property failure.
        const result = evaluateTrustGate(metrics, thresholds);
        assert.ok(typeof result.satisfied === 'boolean');
        assert.ok(Array.isArray(result.reasons));
      }),
      { numRuns: 200 },
    );
  });
});

// Property 2 ---

describe('Property 2: Per-capability trust thresholds are independent', () => {
  it('changing one capability thresholds does not affect evaluation with another', async () => {
    await fc.assert(
      fc.property(
        metricsArb,
        thresholdsArb,
        thresholdsArb,
        thresholdsArb,
        (metrics, thresholdsA, thresholdsB, thresholdsB2) => {
          // Evaluate capability A with thresholdsA
          const resultA1 = evaluateTrustGate(metrics, thresholdsA);

          // Evaluate capability B with thresholdsB (simulates "another capability")
          evaluateTrustGate(metrics, thresholdsB);

          // Now "change" capability B's thresholds to thresholdsB2 and re-evaluate
          evaluateTrustGate(metrics, thresholdsB2);

          // Re-evaluate capability A — the verdict must be unchanged
          const resultA2 = evaluateTrustGate(metrics, thresholdsA);

          assert.equal(
            resultA1.satisfied,
            resultA2.satisfied,
            'evaluating with different thresholds (capability B) affected capability A verdict',
          );
          assert.deepEqual(resultA1.reasons, resultA2.reasons);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Property 3 ---

describe('Property 3: Trust gate hot-reloads — verdict always reflects current values', () => {
  it('verdict after each update equals evaluateTrustGate on the current state', async () => {
    // Generate a sequence of (metrics, thresholds) updates and verify each
    // evaluation always reflects the CURRENT inputs — no caching/staleness.
    const updateArb = fc.array(
      fc.tuple(metricsArb, thresholdsArb),
      { minLength: 2, maxLength: 10 },
    );

    await fc.assert(
      fc.property(updateArb, (updates) => {
        for (const [metrics, thresholds] of updates) {
          const result = evaluateTrustGate(metrics, thresholds);

          // Independently compute the expected result
          const coverageOk =
            metrics.citationCoverage !== undefined &&
            metrics.citationCoverage > thresholds.citationCoverageMin;
          const agreementOk =
            metrics.modelHumanAgreement !== undefined &&
            metrics.modelHumanAgreement > thresholds.modelHumanAgreementMin;
          const legalOk = thresholds.legalReviewComplete === true;
          const expected = coverageOk && agreementOk && legalOk;

          assert.equal(
            result.satisfied,
            expected,
            `Stale verdict detected: after update to metrics=${JSON.stringify(metrics)}, ` +
              `thresholds=${JSON.stringify(thresholds)}, expected=${expected}, got=${result.satisfied}`,
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it('a not-satisfied→satisfied transition takes effect on next evaluation', async () => {
    await fc.assert(
      fc.property(
        // Generate thresholds where legalReviewComplete is false (gate will be unsatisfied)
        fc.double({ min: 0, max: 0.9, noNaN: true }),
        fc.double({ min: 0, max: 0.9, noNaN: true }),
        (covMin, agrMin) => {
          const thresholdsClosed: TrustThresholds = {
            citationCoverageMin: covMin,
            modelHumanAgreementMin: agrMin,
            legalReviewComplete: false,
          };

          const thresholdsOpen: TrustThresholds = {
            citationCoverageMin: covMin,
            modelHumanAgreementMin: agrMin,
            legalReviewComplete: true,
          };

          // Metrics that exceed both numeric thresholds
          const metrics: TrustMetrics = {
            citationCoverage: Math.min(covMin + 0.05, 1),
            modelHumanAgreement: Math.min(agrMin + 0.05, 1),
          };

          // First: gate closed
          const r1 = evaluateTrustGate(metrics, thresholdsClosed);
          assert.equal(r1.satisfied, false, 'should be closed when legal=false');

          // Transition: flip legal flag (simulates hot-reload)
          const r2 = evaluateTrustGate(metrics, thresholdsOpen);
          assert.equal(r2.satisfied, true, 'should be satisfied after legal flip');

          // Regression: flip back
          const r3 = evaluateTrustGate(metrics, thresholdsClosed);
          assert.equal(r3.satisfied, false, 'should revert on regression');
        },
      ),
      { numRuns: 100 },
    );
  });
});
