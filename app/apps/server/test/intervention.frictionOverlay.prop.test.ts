// Feature: intervention-and-scale, Property 7: Friction overlay projection is faithful and label-bounded
// Feature: intervention-and-scale, Property 8: Friction is served only for existing, ready reports
// Validates: Requirements 2.2, 2.3, 3.3, 4.3, 4.4, 4.6

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { projectFrictionOverlay } from '../src/core/frictionOverlay';
import { gateValidReportArbitrary } from './reportGraph.arb';

const BASE_URL = 'https://app.f-socials.example';

describe('Property 7: Friction overlay projection is faithful and label-bounded', () => {
  it('produces one framing signal per report framing signal with verbatim fields', () => {
    fc.assert(
      fc.property(gateValidReportArbitrary, (report) => {
        const result = projectFrictionOverlay(report, BASE_URL);

        // One signal per report framing signal
        assert.equal(
          result.framingSignals.length,
          report.framingSignals.length,
          'must produce exactly one FrictionSignal per report FramingSignal',
        );

        // Each carries verbatim technique, quote (first example), explanation —
        // no added editorializing. The generator guarantees >=1 example per
        // framing signal, so examples[0] is always present.
        for (const reportSignal of report.framingSignals) {
          const firstExample = reportSignal.examples[0];
          assert.ok(firstExample, 'generator guarantees >=1 example per framing signal');
          const match = result.framingSignals.find(
            (fs) => fs.technique === reportSignal.technique &&
              fs.quote === firstExample.text &&
              fs.explanation === firstExample.explanation,
          );
          assert.ok(
            match,
            `expected verbatim signal for technique "${reportSignal.technique}"`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it('sorts highest-severity-first with report-data order as stable tie-break', () => {
    fc.assert(
      fc.property(gateValidReportArbitrary, (report) => {
        const result = projectFrictionOverlay(report, BASE_URL);
        const RANK: Record<string, number> = { high: 2, medium: 1, low: 0 };

        for (let i = 1; i < result.framingSignals.length; i++) {
          const prev = result.framingSignals[i - 1]!;
          const curr = result.framingSignals[i]!;
          // Higher or equal severity must precede lower
          assert.ok(
            (RANK[prev.severity] ?? 0) >= (RANK[curr.severity] ?? 0),
            `signals must be sorted highest-severity-first: ${prev.severity} before ${curr.severity}`,
          );
        }

        // Stable tie-break: signals with same severity preserve report-data order
        // Group by severity, verify within-group order matches report order
        const severities = ['high', 'medium', 'low'] as const;
        for (const sev of severities) {
          const resultIndices = result.framingSignals
            .filter((fs) => fs.severity === sev)
            .map((fs) => fs.technique);

          const reportIndices = report.framingSignals
            .filter((fs) => fs.severity === sev)
            .map((fs) => fs.technique);

          assert.deepEqual(
            resultIndices,
            reportIndices,
            `within severity "${sev}", order must match report-data order`,
          );
        }
      }),
      { numRuns: 100 },
    );
  });

  it('produces one evidence item per claim with valid evidenceStrength', () => {
    fc.assert(
      fc.property(gateValidReportArbitrary, (report) => {
        const result = projectFrictionOverlay(report, BASE_URL);
        const VALID_STRENGTHS = new Set(['none', 'weak', 'moderate', 'strong']);

        assert.equal(
          result.evidenceSummary.length,
          report.claims.length,
          'must produce one evidence item per claim',
        );

        for (let i = 0; i < result.evidenceSummary.length; i++) {
          const item = result.evidenceSummary[i]!;
          const claim = report.claims[i]!;
          assert.equal(item.claimText, claim.claimText);
          assert.ok(
            VALID_STRENGTHS.has(item.evidenceStrength),
            `evidenceStrength must be one of none|weak|moderate|strong, got "${item.evidenceStrength}"`,
          );
          assert.equal(item.evidenceStrength, claim.evidenceStrength);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('honest-none display: evidenceStrength "none" carries no truth word', () => {
    // The honest-none path surfaces the label verbatim ('none') — never a
    // true/false/misleading verdict word (Req 4.4).
    const TRUTH_WORDS = ['true', 'false', 'misleading', 'verdict', 'fake', 'real'];
    fc.assert(
      fc.property(gateValidReportArbitrary, (report) => {
        const result = projectFrictionOverlay(report, BASE_URL);
        for (const item of result.evidenceSummary) {
          // The strength label itself is one of the honest, judgment-free labels.
          assert.ok(
            !TRUTH_WORDS.includes(item.evidenceStrength as string),
            `evidenceStrength label must be honest, never a truth word: "${item.evidenceStrength}"`,
          );
        }
        // For honest-none claims, the projected strength is exactly 'none'.
        for (let i = 0; i < report.claims.length; i++) {
          const claim = report.claims[i]!;
          const item = result.evidenceSummary[i]!;
          if (claim.evidenceStrength === 'none') {
            assert.equal(item.evidenceStrength, 'none');
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('constructs report URL correctly using shareSlug when available', () => {
    fc.assert(
      fc.property(gateValidReportArbitrary, fc.webUrl(), (report, baseUrl) => {
        const result = projectFrictionOverlay(report, baseUrl);
        const expectedSlug = report.shareSlug || report.id;
        assert.equal(result.reportUrl, `${baseUrl}/report/${expectedSlug}`);
      }),
      { numRuns: 100 },
    );
  });

  it('emits no aggregate/composite score, no verdict, no creator field', () => {
    fc.assert(
      fc.property(gateValidReportArbitrary, (report) => {
        const result = projectFrictionOverlay(report, BASE_URL);
        const resultObj = result as unknown as Record<string, unknown>;

        // No aggregate/composite score field
        assert.equal('score' in resultObj, false, 'must not have a score field');
        assert.equal('aggregateScore' in resultObj, false, 'must not have aggregateScore');
        assert.equal('compositeScore' in resultObj, false, 'must not have compositeScore');
        assert.equal('overallScore' in resultObj, false, 'must not have overallScore');

        // No verdict field
        assert.equal('verdict' in resultObj, false, 'must not have a verdict field');
        assert.equal('truthVerdict' in resultObj, false, 'must not have truthVerdict');

        // No creator field
        assert.equal('creator' in resultObj, false, 'must not have a creator field');
        assert.equal('creatorRating' in resultObj, false, 'must not have creatorRating');
        assert.equal('creatorReliability' in resultObj, false, 'must not have creatorReliability');
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 8: Friction is served only for existing, ready reports', () => {
  it('projection works for ready reports and returns overlay data', () => {
    fc.assert(
      fc.property(gateValidReportArbitrary, (report) => {
        // gateValidReportArbitrary always produces status: 'ready'
        assert.equal(report.status, 'ready');
        const result = projectFrictionOverlay(report, BASE_URL);

        // Verify it returns meaningful overlay data
        assert.equal(result.reportId, report.id);
        assert.ok(Array.isArray(result.framingSignals));
        assert.ok(Array.isArray(result.evidenceSummary));
        assert.ok(typeof result.reportUrl === 'string');
        assert.ok(result.reportUrl.length > 0);
      }),
      { numRuns: 100 },
    );
  });

  it('serve guard: overlay is returned only for an existing, ready report', () => {
    // Models the route's projection/serve guard: a missing report or any
    // non-'ready' status yields no overlay; only an existing ready report does.
    const STATUSES = ['ready', 'needs_review', 'processing', 'failed'] as const;
    type Report = Parameters<typeof projectFrictionOverlay>[0];
    const serveFriction = (
      report: Report | undefined,
    ): ReturnType<typeof projectFrictionOverlay> | null => {
      if (!report) return null;
      if (report.status !== 'ready') return null;
      return projectFrictionOverlay(report, BASE_URL);
    };

    fc.assert(
      fc.property(
        gateValidReportArbitrary,
        fc.constantFrom(...STATUSES),
        fc.boolean(),
        (report, status, exists) => {
          if (!exists) {
            // Missing report => no overlay
            assert.equal(serveFriction(undefined), null);
            return;
          }
          const candidate = { ...report, status };
          const served = serveFriction(candidate);
          if (status === 'ready') {
            assert.notEqual(served, null, 'ready report must yield overlay data');
            assert.equal(served!.reportId, report.id);
          } else {
            assert.equal(served, null, `non-ready status "${status}" must yield no overlay`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('structurally cannot produce a verdict or creator rating', () => {
    fc.assert(
      fc.property(gateValidReportArbitrary, (report) => {
        const result = projectFrictionOverlay(report, BASE_URL);

        // Exhaustive field check — only allowed keys exist
        const allowedKeys = new Set(['reportId', 'framingSignals', 'evidenceSummary', 'reportUrl']);
        const actualKeys = new Set(Object.keys(result));
        assert.deepEqual(actualKeys, allowedKeys, 'result must contain only allowed keys');

        // Verify no signal carries verdict/creator fields
        for (const signal of result.framingSignals) {
          const signalObj = signal as unknown as Record<string, unknown>;
          assert.equal('verdict' in signalObj, false);
          assert.equal('creator' in signalObj, false);
          assert.equal('creatorRating' in signalObj, false);
        }

        // Verify no evidence item carries verdict/creator fields
        for (const item of result.evidenceSummary) {
          const itemObj = item as unknown as Record<string, unknown>;
          assert.equal('verdict' in itemObj, false);
          assert.equal('creator' in itemObj, false);
          assert.equal('creatorRating' in itemObj, false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
