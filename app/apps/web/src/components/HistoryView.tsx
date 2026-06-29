import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bookmark, FileText, Inbox, RefreshCw, Trash2 } from 'lucide-react';
import { listSavedReports, unsaveReport } from '../api/client';
import type { SavedReportEntry } from '../api/types';

// History_View (#/history) — lists an Authenticated Reader's Saved_Reports.
//
// Compass: this is a lens, not a judge. A SavedReportEntry carries only the
// report identifier and when it was saved; the view renders NO content-truthfulness
// verdict and NO creator-reliability rating (Req 12.1, 12.2). Any source-reliability
// tier lives on the full report's sources/citations, never here (Req 12.3).
//
// Accent is the muted teal #0d9488 (Req 14.6); icons come from lucide-react
// (Req 14.7); status messages are announced through an ARIA live region (Req 14.9);
// every color/icon is paired with an adjacent text label (Req 14.3); the layout is
// a single column at <=768px via .history-entry (Req 14.5).

// The history request must not hang the view: a load that does not complete within
// 10 seconds is surfaced as an error with a retry, never as the empty state (Req 9.9).
const HISTORY_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Loading your saved reports is taking too long. Please try again.')),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Defensive newest-first ordering with a deterministic tie-break (savedAt DESC, then
// reportId DESC) so equal-timestamp entries keep a stable order across reloads, mirroring
// the server's ORDER BY and keeping the view correct regardless of input order (Req 9.2).
function sortNewestFirst(entries: SavedReportEntry[]): SavedReportEntry[] {
  return [...entries].sort((a, b) => {
    if (a.savedAt !== b.savedAt) return a.savedAt < b.savedAt ? 1 : -1;
    return a.reportId < b.reportId ? 1 : -1;
  });
}

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; entries: SavedReportEntry[] }
  | { kind: 'error'; message: string };

export interface HistoryViewProps {
  /** The active Session access token; attached to every saved-reports request (Req 9.1). */
  token: string;
  /** Open the full report view for the selected entry (Req 9.5). */
  onOpenReport: (reportId: string) => void;
  /** Optional back affordance to leave the history surface. */
  onBack?: () => void;
  /**
   * Pipe caught errors to the session layer so a 401 (AuthExpiredError) clears the
   * session and falls back to the Anonymous experience (Req 4.4). Non-401 errors are
   * ignored by the session layer and shown inline here.
   */
  onAuthError?: (error: unknown) => void;
}

export function HistoryView({ token, onOpenReport, onBack, onAuthError }: HistoryViewProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // Single polite live region content: load/remove outcomes are announced without
  // requiring a focus change (Req 14.9).
  const [status, setStatus] = useState('');

  async function load() {
    setPhase({ kind: 'loading' });
    setStatus('Loading your saved reports…');
    try {
      const entries = await withTimeout(listSavedReports(token), HISTORY_TIMEOUT_MS);
      const sorted = sortNewestFirst(entries);
      setPhase({ kind: 'ready', entries: sorted });
      setStatus(
        sorted.length === 0
          ? 'You have no saved reports yet.'
          : `Loaded ${sorted.length} saved report${sorted.length === 1 ? '' : 's'}.`,
      );
    } catch (e) {
      onAuthError?.(e);
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      setStatus('');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Optimistic exclusion on a successful remove: drop the entry from the list within the
  // same render pass (no page reload, Req 8.2) and announce the change (Req 14.9).
  function handleRemoved(reportId: string) {
    setPhase((p) =>
      p.kind === 'ready'
        ? { kind: 'ready', entries: p.entries.filter((e) => e.reportId !== reportId) }
        : p,
    );
    setStatus('Report removed from your saved list.');
  }

  function back() {
    if (onBack) onBack();
    else if (window.location.hash) window.location.hash = '';
  }

  return (
    <div className="history-view">
      <div className="report-head">
        <div>
          <button
            className="btn btn-ghost"
            onClick={back}
            style={{ height: 34, padding: '0 12px' }}
          >
            <ArrowLeft size={15} /> Back
          </button>
          <h2 className="editorial">
            <Bookmark
              size={18}
              aria-hidden="true"
              style={{ color: '#0d9488', verticalAlign: '-3px', marginRight: 6 }}
            />
            Saved reports
          </h2>
          <div className="meta-row">
            <span>The reports you have saved, most recently saved first.</span>
          </div>
        </div>
        <div className="head-actions">
          <button
            className="btn btn-ghost"
            style={{ height: 38, padding: '0 14px', flexShrink: 0 }}
            onClick={() => void load()}
            disabled={phase.kind === 'loading'}
            aria-label="Refresh your saved reports"
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {/* Visually-hidden polite live region for status announcements (Req 14.9). */}
      <div className="sr-only" role="status" aria-live="polite">
        {status}
      </div>

      {phase.kind === 'loading' && (
        <div className="loading" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="section-label">Loading your saved reports…</div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div>
          <div className="banner error" role="alert">
            <AlertTriangle size={14} aria-hidden="true" /> {phase.message}
          </div>
          <div className="error-actions">
            <button className="btn" onClick={() => void load()}>
              <RefreshCw size={15} /> Retry
            </button>
            <button className="btn btn-ghost" onClick={back}>
              Back
            </button>
          </div>
        </div>
      )}

      {/* Empty state only in the ready phase with zero entries (Req 9.3); hidden as soon
          as there is at least one entry (Req 9.4) and never shown on error (Req 9.9). */}
      {phase.kind === 'ready' && phase.entries.length === 0 && (
        <div
          className="mini-card"
          role="status"
          style={{ textAlign: 'center', color: 'var(--text-muted)' }}
        >
          <Inbox size={20} aria-hidden="true" style={{ marginBottom: 6 }} />
          <p style={{ margin: 0 }}>
            You have no saved reports yet. Save a report from its page and it will appear here.
          </p>
        </div>
      )}

      {phase.kind === 'ready' && phase.entries.length > 0 && (
        <ul className="history-list">
          {phase.entries.map((entry) => (
            <HistoryEntryRow
              key={entry.reportId}
              entry={entry}
              token={token}
              onOpenReport={onOpenReport}
              onRemoved={handleRemoved}
              onAuthError={onAuthError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// One saved-report row. Owns its own busy/error state so a failed remove leaves the
// entry in the list (Req 8.5) with its controls operable for retry, without disturbing
// sibling rows.
function HistoryEntryRow({
  entry,
  token,
  onOpenReport,
  onRemoved,
  onAuthError,
}: {
  entry: SavedReportEntry;
  token: string;
  onOpenReport: (reportId: string) => void;
  onRemoved: (reportId: string) => void;
  onAuthError?: (error: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await unsaveReport(entry.reportId, token);
      onRemoved(entry.reportId); // success → exclude the row (it unmounts)
    } catch (e) {
      onAuthError?.(e);
      // Retain the entry and surface an inline error; re-enable for retry (Req 8.5).
      setError(e instanceof Error ? e.message : 'The removal did not complete. Please try again.');
      setBusy(false);
    }
  }

  return (
    <li className="mini-card history-entry">
      <div className="history-entry-main">
        {/* Select-to-open the full report (Req 9.5). */}
        <button
          type="button"
          className="history-open"
          onClick={() => onOpenReport(entry.reportId)}
          aria-label={`Open saved report ${entry.reportId}`}
        >
          <FileText size={15} aria-hidden="true" />
          <span className="history-report-id">{entry.reportId}</span>
        </button>
        <div className="history-saved-at">Saved {formatSavedAt(entry.savedAt)}</div>
      </div>

      <div className="history-entry-actions">
        <button
          type="button"
          className="btn btn-ghost"
          style={{ height: 34, padding: '0 12px' }}
          onClick={() => void remove()}
          disabled={busy}
          aria-label={`Remove saved report ${entry.reportId}`}
        >
          <Trash2 size={15} aria-hidden="true" /> {busy ? 'Removing…' : 'Remove'}
        </button>
      </div>

      {error && (
        <div className="banner error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" /> {error}
        </div>
      )}
    </li>
  );
}
