// Feature: progressive-disclosure-report-ui, Property 3: Expand-then-collapse round-trips a drawer to its first-paint state
// Validates: Requirements 2.3, 2.6
//
// For any Disclosure_Drawer, activating it to expand and then activating it again to
// collapse returns the drawer to exactly its first-paint state: its content is absent
// from the DOM and its control's aria-expanded is "false".
import { describe, it, expect } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import { DisclosureSection } from './DisclosureSection';

// Non-blank strings: titles and unique child markers must carry visible content so the
// presence/absence assertions are meaningful.
const nonBlank = fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0);

describe('Property 3: expand-then-collapse round-trips a drawer to its first-paint state', () => {
  it('returns aria-expanded to false and removes the child content after expand→collapse', () => {
    fc.assert(
      fc.property(nonBlank, nonBlank, (title, marker) => {
        // A unique, prefixed marker so we can detect the child verbatim in the DOM.
        // Assert against raw textContent (whitespace-preserving) rather than RTL's
        // whitespace-normalizing text queries, so arbitrary markers match exactly.
        const childText = `child::${marker}`;
        const { container, getByRole } = render(
          <DisclosureSection title={title}>
            <p>{childText}</p>
          </DisclosureSection>,
        );
        try {
          const control = getByRole('button');
          const childPresent = () => (container.textContent ?? '').includes(childText);

          // First-paint state: collapsed, child absent.
          expect(control.getAttribute('aria-expanded')).toBe('false');
          expect(childPresent()).toBe(false);
          const firstPaintHtml = container.innerHTML;

          // Activate to expand: child present, aria-expanded true.
          fireEvent.click(control);
          expect(control.getAttribute('aria-expanded')).toBe('true');
          expect(childPresent()).toBe(true);

          // Activate again to collapse: must match the captured first-paint state exactly.
          fireEvent.click(control);
          expect(control.getAttribute('aria-expanded')).toBe('false');
          expect(childPresent()).toBe(false);
          expect(container.innerHTML).toBe(firstPaintHtml);
        } finally {
          // fast-check reuses the DOM across runs; reset between iterations.
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  });
});
