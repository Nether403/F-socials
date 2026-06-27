// Feature: trust-and-launch-bundle, Property 14: TLDR and the top framing signal
// render unexpanded on first paint (Validates: Requirements 4.10)
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import { Report, topFramingSignal } from './Report';
import type { AnalysisReport, FramingSignal } from '../api/types';

// Must render some visible (non-whitespace) text so it can be located on screen.
const nonBlank = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

// RTL collapses/trims whitespace in DOM text but not in a string matcher, so compare
// on normalized text: find an element whose own text equals the normalized target.
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const byText = (target: string) => (content: string, el: Element | null) =>
  el != null && norm(el.textContent ?? '') === norm(target);

const framingSignal = fc.record({
  technique: nonBlank,
  severity: fc.constantFrom<FramingSignal['severity']>('low', 'medium', 'high'),
  description: fc.string(),
  examples: fc.constant([] as FramingSignal['examples']),
});

// A ready report carrying a (non-empty) TLDR and 1..n framing signals.
function buildReport(tldr: string, framingSignals: FramingSignal[]): AnalysisReport {
  const now = new Date(0).toISOString();
  return {
    id: 'r1',
    status: 'ready',
    version: 1,
    producingLayer: 'test',
    tldr,
    transcript: 'A short transcript.',
    claims: [],
    framingSignals,
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe('Property 14: TLDR and top framing signal render unexpanded on first paint', () => {
  it('initial render (no clicks/tab switch/drawer) shows the TLDR and the highest-severity signal', () => {
    fc.assert(
      fc.property(nonBlank, fc.array(framingSignal, { minLength: 1 }), (tldr, signals) => {
        // Highest severity, first-wins — the exact rule the component uses for the top card.
        const top = topFramingSignal(signals)!;

        // Render and assert immediately, without any interaction.
        render(<Report report={buildReport(tldr, signals)} onBack={() => {}} />);
        try {
          // TLDR text is on screen at first paint.
          expect(screen.getAllByText(byText(tldr)).length).toBeGreaterThan(0);
          // The top signal's technique and "<severity> severity" tag are on screen too.
          // The Framing tab (which would also render techniques) is inactive on first
          // paint, so these come from the always-rendered "Most important signal" card.
          expect(screen.getAllByText(byText(top.technique)).length).toBeGreaterThan(0);
          expect(screen.getAllByText(byText(`${top.severity} severity`)).length).toBeGreaterThan(0);
        } finally {
          // fast-check reuses the DOM across runs; reset between iterations.
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 30000); // 100 full <Report> renders need more than the 5s default.
});
