// Feature: trust-and-launch-bundle, methodology unavailable path (Validates: 1.12)
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../i18n/context';
import { Methodology } from './Methodology';

// Mock the API client so the /policy fetch REJECTS, exercising the graceful-degradation
// path: the component catches the rejection and sets the policy state to 'unavailable'.
vi.mock('../api/client', () => ({
  getPolicy: vi.fn().mockRejectedValue(new Error('down')),
}));

describe('Methodology unavailable path (1.12)', () => {
  // 1.12 — when GET /policy fails the page degrades gracefully: it shows a neutral
  // "policy version unavailable" indication AND still renders the rest of the page.
  it('shows the unavailable indication while still rendering the page', async () => {
    render(<LanguageProvider><Methodology onBack={() => {}} /></LanguageProvider>);

    // The core page renders immediately, independent of the failing fetch.
    expect(screen.getByRole('heading', { name: /how f-socials works/i })).toBeInTheDocument();

    // The unavailable indication appears once the rejected fetch settles (async).
    expect(await screen.findByText(/policy version unavailable/i)).toBeInTheDocument();

    // The page retains its substantive context rather than blanking out: the
    // neutral fallback note replaces the live tier table, and the other sections remain.
    expect(screen.getByText(/the tier definitions and open signals could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/our neutrality commitment/i)).toBeInTheDocument();
    expect(screen.getByText(/who reviews reports/i)).toBeInTheDocument();
  });
});
