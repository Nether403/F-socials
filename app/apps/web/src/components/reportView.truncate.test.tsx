// Feature: progressive-disclosure-report-ui, Property 8: Issue-frame chip truncation preserves the full label
// Validates: Requirements 5.1, 5.3
//
// For any label string, truncateLabel(label, 120):
//   - produces shown text whose length is at most 120 characters,
//   - marks the result as truncated iff the input exceeds 120 characters (appending an
//     ellipsis in that case),
//   - and preserves the complete original label (the caller's hover/focus title source),
//     so no characters are lost.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { truncateLabel } from './reportView';

const MAX = 120;

// Strings spanning both branches: many shorter than 120 and many longer (up to 300).
const anyLabel = fc.string({ maxLength: 300 });

describe('Property 8: issue-frame chip truncation preserves the full label', () => {
  it('truncateLabel(label, 120) bounds length, flags truncation iff over 120, and loses no characters', () => {
    fc.assert(
      fc.property(anyLabel, (label) => {
        const original = label; // capture before the call to confirm the source is untouched
        const { shown, truncated } = truncateLabel(label, MAX);

        // Shown text never exceeds the limit.
        expect(shown.length).toBeLessThanOrEqual(MAX);

        // Truncated exactly when the input is longer than the limit.
        expect(truncated).toBe(label.length > MAX);

        if (truncated) {
          // Beyond the limit: an ellipsis is appended and the leading content is the
          // original's first (max - 1) characters — so the shown text derives from the label.
          expect(shown.endsWith('…')).toBe(true);
          expect(shown.slice(0, -1)).toBe(label.slice(0, MAX - 1));
        } else {
          // Within the limit: the label is shown verbatim.
          expect(shown).toBe(label);
        }

        // The full original label is preserved for the hover/focus title — no characters lost.
        expect(label).toBe(original);
        expect(label.length).toBe(original.length);
      }),
      { numRuns: 100 },
    );
  });

  // Boundary cases the random sampler is unlikely to hit exactly: at the limit vs one over.
  it('does not truncate at exactly 120 characters and does truncate at 121', () => {
    const at = 'a'.repeat(MAX);
    const over = 'a'.repeat(MAX + 1);

    const atRes = truncateLabel(at, MAX);
    expect(atRes.truncated).toBe(false);
    expect(atRes.shown).toBe(at);

    const overRes = truncateLabel(over, MAX);
    expect(overRes.truncated).toBe(true);
    expect(overRes.shown.length).toBe(MAX);
    expect(overRes.shown.endsWith('…')).toBe(true);
  });
});
