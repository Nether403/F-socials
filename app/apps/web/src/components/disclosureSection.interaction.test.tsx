// Feature: progressive-disclosure-report-ui — interaction (example) tests for DisclosureSection
// Validates: Requirements 2.2, 2.4, 2.5, 7.2, 7.3, 7.7
//
// The disclosure control must be a keyboard- and pointer-operable toggle: it expands and
// collapses on click and on Enter/Space, reflects its state through aria-expanded, is
// reachable by Tab (focusable role="button" with tabIndex 0), and carries the class the
// stylesheet targets with a :focus-visible ring (jsdom cannot compute :focus-visible
// styles, so class presence is the smoke assertion for a visible focus indicator).
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { DisclosureSection } from './DisclosureSection';

const CHILD = 'drawer-child-content';

function renderSection() {
  const utils = render(
    <DisclosureSection title="Section title">
      <p>{CHILD}</p>
    </DisclosureSection>,
  );
  const control = utils.getByRole('button');
  const childPresent = () => (utils.container.textContent ?? '').includes(CHILD);
  return { ...utils, control, childPresent };
}

afterEach(() => cleanup());

describe('DisclosureSection interaction', () => {
  it('expands on click and collapses on a second click, reflecting aria-expanded', () => {
    const { control, childPresent } = renderSection();

    // First paint: collapsed, child absent.
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(childPresent()).toBe(false);

    fireEvent.click(control);
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(childPresent()).toBe(true);

    fireEvent.click(control);
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(childPresent()).toBe(false);
  });

  it('toggles via the Enter key on the focused control', () => {
    const { control, childPresent } = renderSection();

    fireEvent.keyDown(control, { key: 'Enter' });
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(childPresent()).toBe(true);

    fireEvent.keyDown(control, { key: 'Enter' });
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(childPresent()).toBe(false);
  });

  it('toggles via the Space key without preventDefault breaking the toggle', () => {
    const { control, childPresent } = renderSection();

    // preventDefault on Space stops the page from scrolling but must still toggle.
    const expandEvt = fireEvent.keyDown(control, { key: ' ' });
    expect(expandEvt).toBe(false); // event was canceled (preventDefault called)
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(childPresent()).toBe(true);

    fireEvent.keyDown(control, { key: ' ' });
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(childPresent()).toBe(false);
  });

  it('ignores keys other than Enter and Space', () => {
    const { control, childPresent } = renderSection();

    fireEvent.keyDown(control, { key: 'a' });
    fireEvent.keyDown(control, { key: 'ArrowDown' });
    expect(control.getAttribute('aria-expanded')).toBe('false');
    expect(childPresent()).toBe(false);
  });

  it('is Tab-reachable: a role=button control with tabIndex 0 that can hold focus', () => {
    const { control } = renderSection();

    expect(control.getAttribute('role')).toBe('button');
    expect(control.getAttribute('tabindex')).toBe('0');

    control.focus();
    expect(document.activeElement).toBe(control);
  });

  it('reflects aria-expanded: false on first paint, true once open', () => {
    const { control } = renderSection();

    expect(control.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(control);
    expect(control.getAttribute('aria-expanded')).toBe('true');
  });

  it('carries the disclosure-head class the stylesheet targets with :focus-visible', () => {
    // jsdom cannot compute :focus-visible styles, so we smoke-assert the hook class is
    // present; the actual outline rule lives in styles.css (.disclosure-head:focus-visible).
    const { control } = renderSection();
    expect(control.classList.contains('disclosure-head')).toBe(true);
  });
});
