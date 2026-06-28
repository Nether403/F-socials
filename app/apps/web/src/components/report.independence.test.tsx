// Feature: progressive-disclosure-report-ui, Property 4: Toggling one drawer leaves every other drawer unchanged
// Validates: Requirements 2.7
import { describe, it, expect } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import fc from 'fast-check';
import { Report } from './Report';
import type {
  AnalysisReport,
  Claim,
  FramingSignal,
  PerspectiveLink,
  ContextCard,
} from '../api/types';

// Visible, non-whitespace text so any rendered content is real (mirrors aboveFold.test.tsx).
const nonBlank = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);
const coord = fc.double({ min: -1, max: 1, noNaN: true });

const framingSignal: fc.Arbitrary<FramingSignal> = fc.record({
  technique: nonBlank,
  severity: fc.constantFrom<FramingSignal['severity']>('low', 'medium', 'high'),
  description: fc.string(),
  examples: fc.constant([] as FramingSignal['examples']),
});

const claim: fc.Arbitrary<Claim> = fc.record({
  id: fc.uuid(),
  claimText: nonBlank,
  verifiability: fc.constantFrom('verifiable', 'partially_verifiable', 'opinion', 'unverifiable'),
  evidenceStrength: fc.constantFrom('strong', 'moderate', 'weak', 'none'),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  citations: fc.constant([]),
});

const contextCard: fc.Arbitrary<ContextCard> = fc.record({
  title: nonBlank,
  description: fc.string(),
});

const perspective: fc.Arbitrary<PerspectiveLink> = fc.record({
  url: fc.webUrl(),
  sourceName: nonBlank,
  sourceTier: fc.constantFrom('tier1_primary', 'tier2_institutional', 'tier3_viewpoint', 'excluded'),
  issueFrameLabel: nonBlank,
  divergence: fc.double({ min: 0, max: 1, noNaN: true }),
  dehumanization: fc.double({ min: 0, max: 1, noNaN: true }),
});

// A ready report with issueFrame present, so all five disclosure drawers exist (Claim Ledger,
// Framing Signals, Useful Context, Other Angles, Issue-Frame Position). Arrays are kept small
// to keep 100 full <Report> renders fast.
const reportArb: fc.Arbitrary<AnalysisReport> = fc.record({
  claims: fc.array(claim, { maxLength: 2 }),
  framingSignals: fc.array(framingSignal, { maxLength: 2 }),
  contextCards: fc.array(contextCard, { maxLength: 1 }),
  perspectives: fc.array(perspective, { maxLength: 1 }),
  label: nonBlank,
  x: coord,
  y: coord,
}).map(({ claims, framingSignals, contextCards, perspectives, label, x, y }) => {
  const now = new Date(0).toISOString();
  return {
    id: 'r1',
    status: 'ready',
    version: 1,
    producingLayer: 'test',
    transcript: 'A short transcript.',
    issueFrame: { label, x, y },
    claims,
    framingSignals,
    contextCards,
    perspectives,
    createdAt: now,
    updatedAt: now,
  } satisfies AnalysisReport;
});

// The five drawer controls are exactly the `.disclosure-head` elements. Nested claim-card heads
// (`.claim-head`) and the framing-signal selector (`aria-pressed`, not aria-expanded) are NOT
// matched here, so this isolates the page-level drawers even after one is opened.
type DrawerState = { expanded: string | null; hasBody: boolean };
function readDrawers(container: HTMLElement): DrawerState[] {
  return Array.from(container.querySelectorAll('.disclosure')).map((d) => ({
    expanded: d.querySelector('.disclosure-head')!.getAttribute('aria-expanded'),
    hasBody: d.querySelector(':scope > .disclosure-body') != null,
  }));
}

describe('Property 4: Toggling one drawer leaves every other drawer unchanged', () => {
  it('toggling a single drawer flips only its own aria-expanded and content visibility', () => {
    fc.assert(
      fc.property(reportArb, fc.nat(), (report, rawTarget) => {
        const { container } = render(<Report report={report} onBack={() => {}} />);
        try {
          const heads = Array.from(container.querySelectorAll<HTMLElement>('.disclosure-head'));
          // issueFrame is always present, so all five drawers render.
          expect(heads.length).toBe(5);

          const target = rawTarget % heads.length;
          const before = readDrawers(container);
          // First paint: every drawer is collapsed (sanity guard for the property's premise).
          expect(before.every((d) => d.expanded === 'false' && !d.hasBody)).toBe(true);

          // Expand the chosen drawer.
          fireEvent.click(heads[target]);
          const afterOpen = readDrawers(container);
          afterOpen.forEach((d, i) => {
            if (i === target) {
              expect(d.expanded).toBe('true');
              expect(d.hasBody).toBe(true);
            } else {
              // Every other drawer is untouched by the toggle.
              expect(d.expanded).toBe(before[i].expanded);
              expect(d.hasBody).toBe(before[i].hasBody);
            }
          });

          // Toggle the same drawer again: independence holds on collapse too.
          fireEvent.click(heads[target]);
          const afterClose = readDrawers(container);
          afterClose.forEach((d, i) => {
            expect(d.expanded).toBe(before[i].expanded);
            expect(d.hasBody).toBe(before[i].hasBody);
          });
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 30000); // 100 full <Report> renders need more than the 5s default.
});
