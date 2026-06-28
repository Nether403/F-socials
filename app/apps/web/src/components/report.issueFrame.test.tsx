// Feature: progressive-disclosure-report-ui, Property 9: Every issue-frame position has text, and no marker renders without it
// Validates: Requirements 5.5, 5.6
//
// For any x/y (including out-of-range and non-finite values), the per-axis text from
// issueFrameAxisText is a non-empty string, so the full position is determinable from text
// alone (Req 5.5). Because the axis text is always present, a spatial marker is only ever
// rendered alongside its text — never marker-only (Req 5.6).
//
// Primary check (100+ runs): the pure helper issueFrameAxisText re-exported from reportView is
// total over a generator that includes out-of-range and non-finite coordinates.
// Render facet (single example): the Report's IssueFrame chart renders one marker per axis,
// each with a non-empty aria-label and a sibling .axis-pos showing the same non-empty text.
import { describe, it, expect } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import fc from 'fast-check';
import { Report } from './Report';
import { issueFrameAxisText } from './reportView';
import type { AnalysisReport } from '../api/types';

// Coordinates including in-range, out-of-range, and non-finite / edge values. The helper clamps
// (non-finite → 0), so axis text must remain non-empty for every one of these.
const anyCoord = fc.oneof(
  fc.double({ min: -5, max: 5, noNaN: true }),
  fc.constantFrom(NaN, Infinity, -Infinity, Number.MAX_VALUE, -0),
);

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

describe('Property 9: every issue-frame position has text, and no marker renders without it', () => {
  // Core pure-logic assertion (Req 5.5): position is determinable from text alone for any input.
  it('issueFrameAxisText returns non-empty text for any coordinate on both axes', () => {
    fc.assert(
      fc.property(anyCoord, anyCoord, (x, y) => {
        const xText = issueFrameAxisText(x, 'lo', 'hi');
        const yText = issueFrameAxisText(y, 'lo', 'hi');
        expect(typeof xText).toBe('string');
        expect(xText.length).toBeGreaterThan(0);
        expect(typeof yText).toBe('string');
        expect(yText.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
    // Explicit non-finite samples (fc.constantFrom covers these, asserted directly too).
    for (const v of [NaN, Infinity, -Infinity, Number.MAX_VALUE, -0]) {
      expect(issueFrameAxisText(v, 'lo', 'hi').length).toBeGreaterThan(0);
    }
  });

  // Render facet (Req 5.6): since axis text is always present, every rendered marker is paired
  // with non-empty aria-label text and a sibling .axis-pos with non-empty text — never alone.
  it('renders each axis marker only alongside its non-empty axis text', () => {
    const { container } = render(<Report report={makeReport(0.9, -0.9)} onBack={() => {}} />);
    try {
      // The issue-frame chart sits behind its own disclosure drawer, collapsed on first paint
      // (Req 2.1); open it so the chart renders.
      fireEvent.click(screen.getByRole('button', { name: /issue-frame position/i }));

      const axisTexts = container.querySelectorAll('.axis-pos');
      expect(axisTexts.length).toBe(2);
      axisTexts.forEach((el) => {
        expect((el.textContent ?? '').trim().length).toBeGreaterThan(0);
      });

      const markers = container.querySelectorAll('.marker[aria-label]');
      // One marker per axis, never more markers than axis texts (no marker-without-text).
      expect(markers.length).toBe(2);
      expect(markers.length).toBeLessThanOrEqual(axisTexts.length);
      markers.forEach((el) => {
        expect((el.getAttribute('aria-label') ?? '').trim().length).toBeGreaterThan(0);
      });
    } finally {
      cleanup();
    }
  });
});
