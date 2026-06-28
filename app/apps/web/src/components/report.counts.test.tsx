// Feature: progressive-disclosure-report-ui, Property 13: Section counts equal their collection lengths
// Validates: Requirements 8.2
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import { Report } from './Report';
import { sectionCounts } from './reportView';
import type {
  AnalysisReport,
  Citation,
  Claim,
  ContextCard,
  FramingSignal,
  IssueFrame,
  PerspectiveLink,
  SourceTier,
} from '../api/types';

afterEach(cleanup);

const tier = fc.constantFrom<SourceTier>(
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
);
const severity = fc.constantFrom<FramingSignal['severity']>('low', 'medium', 'high');

const citation: fc.Arbitrary<Citation> = fc.record({
  sourceUrl: fc.webUrl(),
  sourceName: fc.string(),
  sourceTier: tier,
  supports: fc.constantFrom(true, false, null),
});

const claim: fc.Arbitrary<Claim> = fc.record({
  id: fc.uuid(),
  claimText: fc.string(),
  verifiability: fc.constantFrom('verifiable', 'partially_verifiable', 'opinion', 'unverifiable'),
  evidenceStrength: fc.constantFrom('strong', 'moderate', 'weak', 'none'),
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
});

const perspective: fc.Arbitrary<PerspectiveLink> = fc.record({
  url: fc.webUrl(),
  sourceName: fc.string(),
  sourceTier: tier,
  issueFrameLabel: fc.string(),
  divergence: fc.double({ min: 0, max: 1, noNaN: true }),
  dehumanization: fc.double({ min: 0, max: 1, noNaN: true }),
});

const issueFrame: fc.Arbitrary<IssueFrame> = fc.record({
  label: fc.string(),
  x: fc.double({ min: -1, max: 1, noNaN: true }),
  y: fc.double({ min: -1, max: 1, noNaN: true }),
});

// Independently-sized arrays so each section's count is exercised against an unrelated length.
// maxLength includes 0 so empty sections (which must still render "(0)") are covered.
const report: fc.Arbitrary<AnalysisReport> = fc
  .record({
    tldr: fc.option(fc.string(), { nil: undefined }),
    issueFrame: fc.option(issueFrame, { nil: undefined }),
    transcript: fc.option(fc.string(), { nil: undefined }),
    claims: fc.array(claim, { maxLength: 5 }),
    framingSignals: fc.array(framingSignal, { maxLength: 5 }),
    contextCards: fc.array(contextCard, { maxLength: 5 }),
    perspectives: fc.array(perspective, { maxLength: 5 }),
  })
  .map((parts) => {
    const now = new Date(0).toISOString();
    return {
      id: 'r1',
      status: 'ready',
      version: 1,
      producingLayer: 'test',
      createdAt: now,
      updatedAt: now,
      ...parts,
    } satisfies AnalysisReport;
  });

// Drawer title → the report collection whose length its count must equal.
const TITLE_TO_COUNT: Record<string, keyof ReturnType<typeof sectionCounts>> = {
  'Claim Ledger': 'claims',
  'Framing Signals': 'framingSignals',
  'Useful Context': 'contextCards',
  'Other Angles': 'perspectives',
};

// Parse the "(N)" rendered in a drawer head's .count span.
function parseCount(text: string | null): number {
  const m = (text ?? '').match(/\((\d+)\)/);
  expect(m).not.toBeNull();
  return Number(m![1]);
}

describe('Property 13: Section counts equal their collection lengths', () => {
  it('renders each section count equal to its collection length, including the header meta-row', () => {
    fc.assert(
      fc.property(report, (r) => {
        const { container } = render(<Report report={r} onBack={() => {}} />);
        try {
          const expected = sectionCounts(r);

          // Each labelled drawer head renders "(N)" equal to its collection length.
          const heads = Array.from(container.querySelectorAll('.disclosure-head'));
          const seen = new Set<string>();
          for (const head of heads) {
            const title = head.querySelector('.disclosure-title')?.textContent ?? '';
            const key = TITLE_TO_COUNT[title];
            if (!key) continue; // e.g. "Issue-Frame Position" carries no count
            seen.add(title);
            expect(parseCount(head.querySelector('.count')?.textContent ?? null)).toBe(expected[key]);
          }
          // All four counted drawers were present and checked.
          expect(seen).toEqual(new Set(Object.keys(TITLE_TO_COUNT)));

          // Header meta-row mirrors the same claim and framing-signal counts.
          const meta = container.querySelector('.meta-row')?.textContent ?? '';
          expect(meta).toContain(`${r.claims.length} claims`);
          expect(meta).toContain(`${r.framingSignals.length} framing signals`);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 30000);
});
