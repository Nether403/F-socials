// Feature: accounts-save-history, History_View component tests
// Validates: Requirements 8.1, 8.2, 8.5, 9.1, 9.3, 9.4, 9.5, 9.9, 12.1, 12.2, 14.3, 14.5, 14.9
//
// Example-based component coverage for HistoryView (task 10.2): empty-state, populated
// newest-first ordering, remove success (optimistic exclusion) and failure (retain +
// error), select-to-open, load error + retry, color-never-alone text labels beside
// icons, the ≤768px single-column rule, and the ARIA live status region. The api/client
// module is mocked so the view never hits the network; the two functions the component
// calls (listSavedReports, unsaveReport) are driven per test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '../i18n/context';
import { HistoryView } from './HistoryView';
import type { SavedReportEntry } from '../api/types';

// Hoisted vi.fns so the mock factory and the assertions reference the same instances.
const api = vi.hoisted(() => ({
  listSavedReports: vi.fn<(token: string) => Promise<SavedReportEntry[]>>(),
  unsaveReport: vi.fn<(reportId: string, token: string) => Promise<void>>(),
}));

vi.mock('../api/client', () => ({
  listSavedReports: api.listSavedReports,
  unsaveReport: api.unsaveReport,
}));

const TOKEN = 'test-access-token';

// Two entries whose savedAt ordering deliberately disagrees with reportId ordering, so a
// correct render proves savedAt DESC drives the order (not the id). The newer entry has
// the alphabetically-earlier id.
const OLDER: SavedReportEntry = { reportId: 'zzz-older', savedAt: '2024-01-01T00:00:00.000Z' };
const NEWER: SavedReportEntry = { reportId: 'aaa-newer', savedAt: '2024-06-01T00:00:00.000Z' };

function renderHistory(overrides: Partial<Parameters<typeof HistoryView>[0]> = {}) {
  const onOpenReport = vi.fn();
  const onBack = vi.fn();
  const onAuthError = vi.fn();
  const utils = render(
    <LanguageProvider>
    <HistoryView
      token={TOKEN}
      onOpenReport={onOpenReport}
      onBack={onBack}
      onAuthError={onAuthError}
      {...overrides}
    />
    </LanguageProvider>,
  );
  return { ...utils, onOpenReport, onBack, onAuthError };
}

beforeEach(() => {
  api.listSavedReports.mockReset();
  api.unsaveReport.mockReset().mockResolvedValue(undefined);
});

describe('HistoryView', () => {
  // 9.1 — opening the view requests the reader's saved reports with the token attached.
  it('requests saved reports with the access token on mount (Req 9.1)', async () => {
    api.listSavedReports.mockResolvedValue([]);
    renderHistory();
    await waitFor(() => expect(api.listSavedReports).toHaveBeenCalledWith(TOKEN));
  });

  // 9.3 — zero saved reports shows the empty-state; 9.4 — the list is absent.
  it('shows the empty-state message when there are no saved reports (Req 9.3, 9.4)', async () => {
    api.listSavedReports.mockResolvedValue([]);
    const { container } = renderHistory();

    // The empty-state paragraph carries the call-to-action copy, distinguishing it from
    // the live-region status which shares the leading sentence.
    expect(
      await screen.findByText(/save a report from its page and it will appear here/i),
    ).toBeInTheDocument();
    // No list rendered while empty (9.4).
    expect(container.querySelector('.history-list')).toBeNull();
  });

  // 9.2 — populated list is ordered most-recently-saved first regardless of input order;
  // 9.4 — the empty-state is hidden once there is at least one entry.
  it('lists saved reports newest-first and hides the empty-state (Req 9.4)', async () => {
    // Input order is OLDER, NEWER; the view must render NEWER first by savedAt DESC.
    api.listSavedReports.mockResolvedValue([OLDER, NEWER]);
    const { container } = renderHistory();

    await screen.findByText(NEWER.reportId);
    const renderedIds = Array.from(container.querySelectorAll('.history-report-id')).map(
      (el) => el.textContent,
    );
    expect(renderedIds).toEqual([NEWER.reportId, OLDER.reportId]);
    expect(screen.queryByText(/you have no saved reports yet/i)).not.toBeInTheDocument();
  });

  // 9.5 — selecting an entry opens the full report for that entry's report id.
  it('opens the selected report (Req 9.5)', async () => {
    api.listSavedReports.mockResolvedValue([NEWER]);
    const { onOpenReport } = renderHistory();
    const user = userEvent.setup();

    const openBtn = await screen.findByRole('button', {
      name: new RegExp(`open saved report ${NEWER.reportId}`, 'i'),
    });
    await user.click(openBtn);
    expect(onOpenReport).toHaveBeenCalledWith(NEWER.reportId);
  });

  // 8.1/8.2 — a successful remove sends one request with the token and optimistically
  // excludes the entry from the view without a reload.
  it('removes an entry on a successful remove (Req 8.1, 8.2)', async () => {
    api.listSavedReports.mockResolvedValue([OLDER, NEWER]);
    renderHistory();
    const user = userEvent.setup();

    const removeNewer = await screen.findByRole('button', {
      name: new RegExp(`remove saved report ${NEWER.reportId}`, 'i'),
    });
    await user.click(removeNewer);

    expect(api.unsaveReport).toHaveBeenCalledWith(NEWER.reportId, TOKEN);
    // The removed row is gone; the sibling row is retained.
    await waitFor(() => expect(screen.queryByText(NEWER.reportId)).not.toBeInTheDocument());
    expect(screen.getByText(OLDER.reportId)).toBeInTheDocument();
  });

  // 8.5 — a failed remove retains the entry and surfaces an error indication; the control
  // re-enables for retry.
  it('retains the entry and shows an error when remove fails (Req 8.5)', async () => {
    api.listSavedReports.mockResolvedValue([NEWER]);
    api.unsaveReport.mockRejectedValueOnce(new Error('The removal did not complete.'));
    renderHistory();
    const user = userEvent.setup();

    const removeBtn = await screen.findByRole('button', {
      name: new RegExp(`remove saved report ${NEWER.reportId}`, 'i'),
    });
    await user.click(removeBtn);

    // Error indication appears and the entry is retained.
    expect(await screen.findByRole('alert')).toHaveTextContent(/removal did not complete/i);
    expect(screen.getByText(NEWER.reportId)).toBeInTheDocument();
    // Re-enabled for retry.
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: new RegExp(`remove saved report ${NEWER.reportId}`, 'i'),
        }),
      ).toBeEnabled(),
    );
  });

  // 9.9 — a failed load shows an error (never the empty-state) and offers a retry that
  // succeeds on the second attempt.
  it('shows an error with a retry on load failure, then recovers (Req 9.9)', async () => {
    api.listSavedReports
      .mockRejectedValueOnce(new Error('Could not load saved reports (500)'))
      .mockResolvedValueOnce([NEWER]);
    renderHistory();
    const user = userEvent.setup();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load saved reports/i);
    // The empty-state must NOT be shown on error (9.9).
    expect(screen.queryByText(/you have no saved reports yet/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText(NEWER.reportId)).toBeInTheDocument();
  });

  // 14.3 — every color/icon signal carries an adjacent visible text label. The Bookmark,
  // FileText, and Trash2 icons are aria-hidden and paired with "Saved reports", a
  // "Saved <when>" label, and a "Remove" label respectively.
  it('pairs every icon with a visible text label (Req 14.3)', async () => {
    api.listSavedReports.mockResolvedValue([NEWER]);
    const { container } = renderHistory();

    await screen.findByText(NEWER.reportId);
    // Heading label beside the teal Bookmark icon.
    expect(screen.getByRole('heading', { name: /saved reports/i })).toBeInTheDocument();
    // "Saved <when>" text beside the FileText icon.
    const savedAt = container.querySelector('.history-saved-at');
    expect(savedAt?.textContent ?? '').toMatch(/^Saved /);
    // "Remove" text beside the Trash2 icon (not color/icon alone).
    expect(screen.getByRole('button', { name: /remove saved report/i })).toHaveTextContent(
      /remove/i,
    );
  });

  // 14.9 — status messages are exposed through a polite ARIA live region so assistive
  // technology announces them without a focus change.
  it('announces status through an ARIA live region (Req 14.9)', async () => {
    api.listSavedReports.mockResolvedValue([NEWER]);
    const { container } = renderHistory();

    const live = container.querySelector('.sr-only[role="status"][aria-live="polite"]');
    expect(live).not.toBeNull();
    // After the load resolves the live region reports the loaded count.
    await waitFor(() => expect(live).toHaveTextContent(/loaded 1 saved report\./i));
  });

  // 12.1/12.2 — the history surface renders no content-truthfulness verdict and no
  // creator-reliability rating; only neutral id + saved-at association data.
  it('renders no verdict and no creator rating (Req 12.1, 12.2)', async () => {
    api.listSavedReports.mockResolvedValue([NEWER, OLDER]);
    const { container } = renderHistory();

    await screen.findByText(NEWER.reportId);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/verdict|true|false|misleading|reliability|credibility|creator rating/i);
  });
});

// 14.5 — at ≤768px the history surface presents its content in a single column. jsdom
// cannot compute layout, so this is a static assertion against the media-query rule that
// collapses each entry's row to a single column.
describe('HistoryView responsive layout (Req 14.5)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(resolve(HERE, '../styles.css'), 'utf8');

  it('stacks history entries into one column at ≤768px', () => {
    const mediaBlock = /@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*)\}/.exec(css)?.[1] ?? '';
    const entryRule = /\.history-entry\s*\{([^}]*)\}/.exec(mediaBlock)?.[1] ?? '';
    expect(entryRule).toMatch(/flex-direction:\s*column/);
  });
});
