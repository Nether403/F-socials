// Feature: en-nl-localization, Task 9.2: Unit + accessibility tests for Language_Selector
// Validates: Requirements 1.1, 1.3, 1.4, 8.1, 8.2, 8.6, 8.8, 8.9
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import { LanguageProvider } from '../i18n/context';
import { LanguageSelector } from './LanguageSelector';

expect.extend(axeMatchers);

// Stub localStorage so LanguageProvider initializes cleanly (defaults to 'en')
beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  });
});

function renderSelector() {
  return render(
    <LanguageProvider>
      <LanguageSelector />
    </LanguageProvider>,
  );
}

describe('LanguageSelector', () => {
  it('renders exactly two button options (Req 1.1)', () => {
    renderSelector();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('marks the active language with aria-pressed="true" and the other "false" (Req 1.4, 8.6)', () => {
    renderSelector();
    const buttons = screen.getAllByRole('button');
    const pressed = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true');
    const notPressed = buttons.filter((b) => b.getAttribute('aria-pressed') === 'false');
    expect(pressed).toHaveLength(1);
    expect(notPressed).toHaveLength(1);
  });

  it('the container has role="group" with a non-empty aria-label (Req 8.2)', () => {
    renderSelector();
    const group = screen.getByRole('group');
    expect(group).toBeInTheDocument();
    const label = group.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label!.trim().length).toBeGreaterThan(0);
  });

  it('clicking the inactive button switches it to active (Req 1.3)', () => {
    renderSelector();
    // Default is 'en', so find the button that is NOT pressed
    const inactive = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-pressed') === 'false',
    )!;
    fireEvent.click(inactive);
    // After click, the previously inactive button should now be pressed
    expect(inactive).toHaveAttribute('aria-pressed', 'true');
  });

  it('includes an SVG icon from lucide-react (Req 8.8)', () => {
    const { container } = renderSelector();
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('both buttons have visible text labels — color-never-alone (Req 8.6, 8.9)', () => {
    renderSelector();
    const buttons = screen.getAllByRole('button');
    buttons.forEach((b) => {
      expect(b.textContent!.trim().length).toBeGreaterThan(0);
    });
  });

  it('passes vitest-axe with no WCAG A/AA violations (Req 8.1)', async () => {
    const { container } = renderSelector();
    const results = await axe(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } }, // jsdom cannot measure real contrast
    });
    expect(results).toHaveNoViolations();
  });
});
