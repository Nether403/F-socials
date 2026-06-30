// Feature: progressive-disclosure-report-ui, Property 12: Rendering never mutates the report
// Validates: Requirements 8.1, 8.5
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent } from '@testing-library/react';
import fc from 'fast-check';
import { Report } from './Report';
import { renderWithLang } from '../test/renderWithLang';
import type {
  AnalysisReport,
  Citation,
  Claim,
  ContextCard,
  FramingSignal,
  IssueFrame,
  PerspectiveLink,
  ReportStatus,
  SourceTier,
} from '../api/types';

afterEach(cleanup);

// The needs_review banner copy (see Report.tsx) always contains this substring; a ready report
// never renders it. This is the rendered reflection of report.status (Req 8.6, 8.7).
const REVIEW_NOTICE = 'held for human review';

const tier = fc.constantFrom<SourceTier>(
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
);
const severity = fc.constantFrom<FramingSignal['severity']>('low', 'medium', 'high');
// Optional free text including whitespace-only and empty, to exercise honest-absence branches.
const maybeText = fc.option(fc.string(), { nil: undefined });

const citation: fc.Arbitrary<Citation> = fc.record({
  sourceUrl: fc.webUrl(),
  sourceName: fc.string(),
  sourceTier: tier,
  excerpt: maybeText,
  supports: fc.constantFrom(true, false, null),
});

const claim: fc.Arbitrary<Claim> = fc.record({
  id: fc.uuid(),
  claimText: fc.string(),
  transcriptSpan: maybeText,
  verifiability: fc.constantFrom('verifiable', 'partially_verifiable', 'opinion', 'unverifiable'),
  evidenceStrength: fc.constantFrom('strong', 'moderate', 'weak', 'none'),
  sourceBasis: maybeText,
  evidenceDescription: maybeText,
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  citations: fc.array(citation, { maxLength: 2 }),
});

const framingSignal: fc.Arbitrary<FramingSignal> = fc.record({
  technique: fc.string(),
  severity,
  description: fc.string(),
  examples: fc.constant([] as FramingSignal['examples']),
});

const contextCard: fc.Arbitrary<ContextCard> = fc.record({
  title: fc.string(),
  description: fc.string(),
  sourceName: maybeText,
  sourceUrl: fc.option(fc.webUrl(), { nil: undefined }),
});

const perspective: fc.Arbitrary<PerspectiveLink> = fc.record({
  url: fc.webUrl(),
  sourceName: fc.string(),
  sourceTier: tier,
  issueFrameLabel: fc.string(),
  divergence: fc.double({ min: 0, max: 1, noNaN: true }),
  dehumanization: fc.double({ min: 0, max: 1, noNaN: true }),
  whyIncluded: maybeText,
});

const issueFrame: fc.Arbitrary<IssueFrame> = fc.record({
  label: fc.string(),
  x: fc.double({ min: -1, max: 1, noNaN: true }),
  y: fc.double({ min: -1, max: 1, noNaN: true }),
});

const status = fc.constantFrom<ReportStatus>('ready', 'needs_review');

const report: fc.Arbitrary<AnalysisReport> = fc
  .record({
    status,
    tldr: maybeText,
    issueFrame: fc.option(issueFrame, { nil: undefined }),
    transcript: maybeText,
    claims: fc.array(claim, { maxLength: 3 }),
    framingSignals: fc.array(framingSignal, { maxLength: 3 }),
    contextCards: fc.array(contextCard, { maxLength: 3 }),
    perspectives: fc.array(perspective, { maxLength: 3 }),
    reasons: fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: undefined }),
  })
  .map((parts) => {
    const now = new Date(0).toISOString();
    return {
      id: 'r1',
      version: 1,
      producingLayer: 'test',
      createdAt: now,
      updatedAt: now,
      ...parts,
    } satisfies AnalysisReport;
  });

describe('Property 12: Rendering never mutates the report', () => {
  it('leaves the report deeply equal to a pre-render clone, and the status notice matches report.status', () => {
    fc.assert(
      fc.property(report, (r) => {
        // Deep snapshot of the exact object graph before React touches it.
        const clone = structuredClone(r);
        const { container } = renderWithLang(<Report report={r} onBack={() => {}} />);
        try {
          // Exercise the interaction handlers: expand the first couple of drawers (and toggle one
          // back) so any write-back during open/collapse would surface as a diff against the clone.
          const heads = container.querySelectorAll<HTMLElement>('.disclosure-head');
          if (heads.length > 0) fireEvent.click(heads[0]);
          if (heads.length > 1) fireEvent.click(heads[1]);
          if (heads.length > 0) fireEvent.click(heads[0]); // collapse the first again

          // Status fidelity: the review notice appears iff status === 'needs_review'. This is a
          // pure reflection of report.status — the gate is never invoked client-side (Req 8.5–8.7).
          const bodyText = document.body.textContent ?? '';
          if (r.status === 'needs_review') {
            expect(bodyText).toContain(REVIEW_NOTICE);
          } else {
            expect(bodyText).not.toContain(REVIEW_NOTICE);
          }

          // Immutability: no field added, removed, renamed, reordered, or written back (Req 8.1).
          expect(r).toEqual(clone);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 30000);
});
