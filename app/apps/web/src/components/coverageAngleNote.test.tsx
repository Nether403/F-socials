// Feature: progressive-disclosure-report-ui, Property 7: Coverage-angle note triggers exactly on a strong axis and names its poles
// Validates: Requirements 4.1, 4.2, 4.4
//
// For any issue-frame position (x, y):
//   - when at least one axis has magnitude > 0.8, strongAxisPoles returns exactly the pole
//     names of the axes exceeding 0.8 (the correct pole for each axis's sign, x before y) and
//     the CoverageAngleNote renders a node;
//   - when every axis has magnitude <= 0.8, strongAxisPoles returns empty and the note is omitted;
//   - when no issue-frame position is present, strongAxisPoles is not consulted and the note is
//     omitted (renders null).
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import { strongAxisPoles } from './reportView';
import { CoverageAngleNote } from './CoverageAngleNote';
import type { IssueFrame } from '../api/types';

const STRONG = 0.8;

// Pole names per the shared convention (negative -> low pole, positive -> high pole).
const X_LOW = 'state / collective';
const X_HIGH = 'market / individual';
const Y_LOW = 'libertarian';
const Y_HIGH = 'authoritarian';

// Independent expectation of the poles for a coordinate pair, computed from the strict > 0.8
// threshold and the axis sign — kept separate from the implementation's internal constants.
function expectedPoles(x: number, y: number): string[] {
  const poles: string[] = [];
  if (Math.abs(x) > STRONG) poles.push(x < 0 ? X_LOW : X_HIGH);
  if (Math.abs(y) > STRONG) poles.push(y < 0 ? Y_LOW : Y_HIGH);
  return poles;
}

// Coordinate arbitraries covering strong (|v| > 0.8), weak (|v| <= 0.8), and both signs.
const anyCoord = fc.double({ min: -2, max: 2, noNaN: true });
// Bias toward values straddling the threshold so both branches are well sampled.
const nearThreshold = fc.constantFrom(-1.5, -1, -0.81, -0.8, -0.5, 0, 0.5, 0.8, 0.81, 1, 1.5);
const coord = fc.oneof(anyCoord, nearThreshold);

describe('Property 7: coverage-angle note triggers exactly on a strong axis and names its poles', () => {
  it('strongAxisPoles returns exactly the strong-axis poles for any coordinates', () => {
    fc.assert(
      fc.property(coord, coord, (x, y) => {
        const frame: IssueFrame = { label: 'Frame', x, y };
        const poles = strongAxisPoles(frame);

        // Exactly the poles for the axes that strictly exceed 0.8, x before y.
        expect(poles).toEqual(expectedPoles(x, y));

        // Count equals the number of strong axes; boundary 0.8 is NOT strong.
        const strongCount = (Math.abs(x) > STRONG ? 1 : 0) + (Math.abs(y) > STRONG ? 1 : 0);
        expect(poles.length).toBe(strongCount);
      }),
      { numRuns: 200 },
    );
  });

  it('CoverageAngleNote renders a node iff a strong axis exists', () => {
    fc.assert(
      fc.property(coord, coord, fc.boolean(), (x, y, hasPerspectives) => {
        const frame: IssueFrame = { label: 'Frame', x, y };
        const strong = strongAxisPoles(frame).length > 0;

        const { container } = render(
          <CoverageAngleNote issueFrame={frame} hasPerspectives={hasPerspectives} />,
        );
        try {
          if (strong) {
            // Note renders and names every strong-axis pole.
            expect(container.firstChild).not.toBeNull();
            const text = container.textContent ?? '';
            for (const pole of expectedPoles(x, y)) {
              expect(text).toContain(pole);
            }
          } else {
            // No strong axis -> omitted entirely (no placeholder node).
            expect(container.firstChild).toBeNull();
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('CoverageAngleNote is omitted when no issue-frame position is present', () => {
    const { container } = render(<CoverageAngleNote hasPerspectives={true} />);
    try {
      expect(container.firstChild).toBeNull();
    } finally {
      cleanup();
    }
  });

  // Boundary cases the random sampler is unlikely to hit exactly: exactly 0.8 is not strong,
  // and just over 0.8 is. Covers both signs on each axis.
  it('treats |value| = 0.8 as not strong and |value| just over 0.8 as strong', () => {
    expect(strongAxisPoles({ label: 'f', x: 0.8, y: -0.8 })).toEqual([]);
    expect(strongAxisPoles({ label: 'f', x: -0.8, y: 0.8 })).toEqual([]);

    expect(strongAxisPoles({ label: 'f', x: 0.81, y: 0 })).toEqual([X_HIGH]);
    expect(strongAxisPoles({ label: 'f', x: -0.81, y: 0 })).toEqual([X_LOW]);
    expect(strongAxisPoles({ label: 'f', x: 0, y: 0.81 })).toEqual([Y_HIGH]);
    expect(strongAxisPoles({ label: 'f', x: 0, y: -0.81 })).toEqual([Y_LOW]);
    expect(strongAxisPoles({ label: 'f', x: 0.81, y: -0.81 })).toEqual([X_HIGH, Y_LOW]);
  });
});
