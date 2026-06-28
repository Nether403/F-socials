// Feature: trust-and-launch-bundle, Property 13: Every issue-frame position has screen-reader text
// Validates: Requirements 4.9
//
// For any issue-frame coordinates x and y in [-1, 1], the rendered chart includes a
// non-empty textual representation of that position. Two complementary checks:
//   1. Pure-helper property (cheap, 100+ runs): issueFramePositionText(x, y) returns a
//      non-empty string for all coordinates — including out-of-range/NaN, which it clamps.
//   2. Rendered check (small fixed set): <Report> with an issueFrame exposes non-empty
//      axis-position text (.axis-pos) and non-empty marker aria-labels.
import { describe, it, expect } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import fc from 'fast-check';
import { Report, issueFramePositionText, issueFrameAxisText } from './Report';
import type { AnalysisReport } from '../api/types';

// Coordinates strictly within the documented [-1, 1] input space.
const inRange = fc.double({ min: -1, max: 1, noNaN: true });
// Anything at all — the helpers clamp, so text must still be non-empty.
const anyNumber = fc.double();

function makeReport(x: number, y: number): AnalysisReport {
  const now = new Date().toISOString();
  return {
    id: 'r1',
    status: 'ready',
    version: 1,
    producingLayer: 'test',
    title: 'Test report',
    issueFrame: { label: 'Frame label', x, y },
    claims: [],
    framingSignals: [],
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe('Property 13: every issue-frame position has screen-reader text', () => {
  // Core of the property: the pure helper is total over the whole input space.
  it('issueFramePositionText returns non-empty text for any x, y in [-1, 1]', () => {
    fc.assert(
      fc.property(inRange, inRange, (x, y) => {
        const text = issueFramePositionText(x, y);
        expect(typeof text).toBe('string');
        expect(text.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  // Totality even outside the documented range and on NaN/±Infinity (the helper clamps).
  it('issueFramePositionText stays non-empty for out-of-range and NaN coordinates', () => {
    fc.assert(
      fc.property(anyNumber, anyNumber, (x, y) => {
        expect(issueFramePositionText(x, y).trim().length).toBeGreaterThan(0);
        expect(issueFrameAxisText(x, 'low', 'high').trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
    // NaN explicitly — fc.double({ noNaN: false }) may not always sample it.
    expect(issueFramePositionText(NaN, NaN).trim().length).toBeGreaterThan(0);
    expect(issueFrameAxisText(NaN, 'low', 'high').trim().length).toBeGreaterThan(0);
  });

  // Rendered check on representative corners/center: the chart shows non-empty axis text
  // and the markers expose non-empty aria-labels for screen readers.
  it('renders non-empty axis text and marker aria-labels for representative positions', () => {
    const coords = [-1, 0, 1];
    for (const x of coords) {
      for (const y of coords) {
        const { container } = render(<Report report={makeReport(x, y)} onBack={() => {}} />);
        try {
          // The issue-frame chart sits behind its own disclosure drawer, collapsed on first
          // paint (progressive-disclosure-report-ui Req 2.1); open it to render the chart.
          fireEvent.click(screen.getByRole('button', { name: /issue-frame position/i }));
          const axisTexts = container.querySelectorAll('.axis-pos');
          // One per axis (economic + governance).
          expect(axisTexts.length).toBe(2);
          axisTexts.forEach((el) => {
            expect((el.textContent ?? '').trim().length).toBeGreaterThan(0);
          });

          const markers = container.querySelectorAll('.marker[aria-label]');
          expect(markers.length).toBe(2);
          markers.forEach((el) => {
            expect((el.getAttribute('aria-label') ?? '').trim().length).toBeGreaterThan(0);
          });
        } finally {
          cleanup();
        }
      }
    }
  });
});
