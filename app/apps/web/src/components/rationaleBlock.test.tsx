// Feature: progressive-disclosure-report-ui, Property 6: Rationale blocks render the source field verbatim
// Validates: Requirements 3.4
//
// For any non-whitespace rationale field text, the rendered Rationale_Block's paragraph
// text content equals that field's text exactly — no prefix, suffix, or substituted
// wording is added. The label is a separate node and is asserted not to bleed into the
// paragraph's text content.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import { RationaleBlock } from './RationaleBlock';

afterEach(() => {
  cleanup();
});

// Any text carrying at least one non-whitespace character — the values for which the
// block renders (whitespace-only/empty are omitted, covered by Property 5).
const nonWhitespaceText = fc.string({ maxLength: 300 }).filter((s) => s.trim().length > 0);
const label = fc.constantFrom('Why included' as const, 'Why this is here' as const);

describe('Property 6: rationale blocks render the source field verbatim', () => {
  it("renders the field text exactly in the paragraph, with no added wording", () => {
    fc.assert(
      fc.property(label, nonWhitespaceText, (lbl, text) => {
        const { container } = render(<RationaleBlock label={lbl} text={text} />);
        try {
          const para = container.querySelector('p');
          // The block renders for non-whitespace text, so the paragraph exists.
          expect(para).not.toBeNull();
          // The paragraph's text content equals the source field exactly — verbatim,
          // no prefix/suffix/substitution.
          expect(para!.textContent).toBe(text);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});
