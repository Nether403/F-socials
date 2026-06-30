// Feature: progressive-disclosure-report-ui, Property 2: Every supporting section is collapsed on first paint
// Validates: Requirements 1.5, 2.1
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
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
  SourceTier,
} from '../api/types';

afterEach(cleanup);

// Unique sentinels: these substrings live ONLY in collapsed drawer content (claim text, context
// card titles, perspective source names). They must never reach the DOM before any interaction.
// They are distinct enough that no header/SummaryLead/generated copy can coincidentally contain them.
const CLAIM_SENTINEL = 'ΩCLAIM_DRAWER_ONLYΩ';
const CTX_SENTINEL = 'ΩCONTEXT_DRAWER_ONLYΩ';
const PERSP_SENTINEL = 'ΩPERSPECTIVE_DRAWER_ONLYΩ';

// Static strings that the live tree renders ONLY inside a drawer body, regardless of data. None of
// them can appear in the header, the SummaryLead, or any chip, so all must be absent at first paint.
const DRAWER_ONLY_STATIC = [
  'Flag this technique', // Framing drawer
  'Read this angle', // Other Angles drawer (perspective link)
  'Where it sits (descriptive, not a verdict)', // Issue-Frame Position drawer
  'Why this is here', // claim RationaleBlock label
  'Why included', // perspective RationaleBlock label
];

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
  // Sentinel-prefixed so its presence anywhere in the DOM is unambiguous drawer leakage.
  claimText: fc.string().map((s) => `${CLAIM_SENTINEL} ${s}`),
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
  title: fc.string().map((s) => `${CTX_SENTINEL} ${s}`),
  description: fc.string(),
});

const perspective: fc.Arbitrary<PerspectiveLink> = fc.record({
  url: fc.webUrl(),
  sourceName: fc.string().map((s) => `${PERSP_SENTINEL} ${s}`),
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

const report: fc.Arbitrary<AnalysisReport> = fc.record({
  tldr: fc.option(fc.string(), { nil: undefined }),
  issueFrame: fc.option(issueFrame, { nil: undefined }),
  transcript: fc.option(fc.string(), { nil: undefined }),
  claims: fc.array(claim, { maxLength: 4 }),
  framingSignals: fc.array(framingSignal, { maxLength: 4 }),
  contextCards: fc.array(contextCard, { maxLength: 4 }),
  perspectives: fc.array(perspective, { maxLength: 4 }),
}).map((parts) => {
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

describe('Property 2: Every supporting section is collapsed on first paint', () => {
  it('renders every drawer collapsed (aria-expanded=false), no drawer content in the DOM, SummaryLead expanded', () => {
    fc.assert(
      fc.property(report, (r) => {
        const { container } = renderWithLang(<Report report={r} onBack={() => {}} />);
        try {
          // Every disclosure control reports collapsed. The only [role=button][aria-expanded]
          // elements at first paint are the section drawer heads — ClaimCard heads and the
          // framing-signal selector live inside collapsed drawers, so they are not yet rendered.
          const controls = Array.from(
            container.querySelectorAll('[role="button"][aria-expanded]'),
          );
          // Four always-present drawers + the Issue-Frame Position drawer only when an issue frame exists.
          const expectedDrawers = 4 + (r.issueFrame ? 1 : 0);
          expect(controls.length).toBe(expectedDrawers);
          for (const c of controls) {
            expect(c.getAttribute('aria-expanded')).toBe('false');
          }

          // No supporting-section content is mounted: collapsed drawers render no children.
          const bodyText = document.body.textContent ?? '';
          expect(bodyText).not.toContain(CLAIM_SENTINEL);
          expect(bodyText).not.toContain(CTX_SENTINEL);
          expect(bodyText).not.toContain(PERSP_SENTINEL);
          for (const marker of DRAWER_ONLY_STATIC) {
            expect(bodyText).not.toContain(marker);
          }
          // No drawer body element is present in the DOM.
          expect(container.querySelector('.disclosure-body')).toBeNull();

          // The SummaryLead is rendered expanded (it has no collapse control).
          expect(container.querySelector('.summary-lead')).not.toBeNull();
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 30000);
});
