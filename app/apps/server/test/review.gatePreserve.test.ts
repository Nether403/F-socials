// Feature: expert-review-queue, Property 8: Invariant-gate preservation under overlay.
//
// For any gate-valid AnalysisReport, overlaying a derived Report_Review_Status onto
// its provenance.reviewStatus leaves every gate-relevant field identical — each
// claim's evidenceStrength and citation set, each framing signal's examples, the
// extracted claim count, and the confidence value — AND re-running assembleReport
// over the report's gate inputs yields the SAME readiness status and the SAME
// reasons as before the overlay. The overlay is constructed exactly as the read
// path does it (routes.ts overlayReviewStatus): a shallow report copy whose
// provenance.reviewStatus is replaced by the derived value, touching nothing else.
//
// Validates: Requirements 5.4, 10.2, 10.4, 10.5

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { assembleReport, type AssembleInput } from '../src/core/assemble';
import { deriveReportReviewStatus } from '../src/core/reportReviewStatus';
import type { AnalysisReport, Provenance, ReviewLifecycle } from '../src/types';
import { gateValidReportArbitrary } from './reportGraph.arb';

const REVIEW_STATUSES: Provenance['reviewStatus'][] = [
  'ai-generated',
  'expert-reviewed',
  'under-dispute',
];

// The exact gate-relevant inputs assembleReport consumes — nothing the overlay
// ever touches. confidence/issueFrame are guaranteed present by the arbitrary.
const gateInputOf = (r: AnalysisReport): AssembleInput => ({
  tldr: r.tldr ?? '',
  issueFrame: r.issueFrame!,
  claims: r.claims,
  framingSignals: r.framingSignals,
  contextCards: r.contextCards,
  perspectives: r.perspectives,
  confidence: r.confidence!,
});

// Mirror routes.ts overlayReviewStatus: replace provenance.reviewStatus on a
// shallow copy of the report, leaving every other field by reference.
const overlay = (report: AnalysisReport, derived: Provenance['reviewStatus']): AnalysisReport => ({
  ...report,
  provenance: report.provenance
    ? { ...report.provenance, reviewStatus: derived }
    : report.provenance,
});

// Attach a provenance with a known base reviewStatus so the overlay has something
// to act on (gateValidReportArbitrary doesn't set provenance — the property is
// about gate-field invariance regardless of the provenance value).
const withProvenance = (
  report: AnalysisReport,
  baseStatus: Provenance['reviewStatus'],
): AnalysisReport => ({
  ...report,
  provenance: {
    model: 'mock',
    analysisVersion: '1',
    sourcePolicyVersion: '1',
    reviewStatus: baseStatus,
    lastUpdated: '1970-01-01T00:00:00.000Z',
    disputesCount: 0,
  },
});

const scenario = fc.record({
  report: gateValidReportArbitrary,
  baseStatus: fc.constantFrom(...REVIEW_STATUSES),
  itemStatuses: fc.array(
    fc.constantFrom<ReviewLifecycle>('pending', 'in_review', 'resolved'),
    { maxLength: 6 },
  ),
});

test('Property 8: overlaying a derived review status preserves every gate-relevant field and the gate verdict', () => {
  fc.assert(
    fc.property(scenario, ({ report, baseStatus, itemStatuses }) => {
      const original = withProvenance(report, baseStatus);
      const derived = deriveReportReviewStatus(baseStatus, itemStatuses);
      const overlaid = overlay(original, derived);

      // 1. The overlay set exactly the review status it was asked to (Req 5.4).
      assert.equal(overlaid.provenance!.reviewStatus, derived);

      // 2. Every gate-relevant field is identical between original and overlaid
      //    copy (Req 10.2): claims (evidenceStrength + citation set), framing
      //    signal examples, claim count, and confidence.
      assert.equal(overlaid.claims.length, original.claims.length);
      assert.equal(overlaid.confidence, original.confidence);
      assert.deepEqual(
        overlaid.claims.map((c) => ({ evidenceStrength: c.evidenceStrength, citations: c.citations })),
        original.claims.map((c) => ({ evidenceStrength: c.evidenceStrength, citations: c.citations })),
      );
      assert.deepEqual(
        overlaid.framingSignals.map((f) => f.examples),
        original.framingSignals.map((f) => f.examples),
      );

      // 3. Re-running the gate over each report's inputs yields the SAME readiness
      //    status and the SAME reasons (Req 10.4) — the overlay never touches the
      //    gate inputs, so the verdict cannot move (Req 10.5).
      const before = assembleReport(gateInputOf(original));
      const after = assembleReport(gateInputOf(overlaid));
      assert.equal(after.status, before.status);
      assert.deepEqual(after.reasons, before.reasons);

      // And, by construction, the gate-valid arbitrary stays 'ready'.
      assert.equal(after.status, 'ready');
    }),
    { numRuns: 200 },
  );
});
