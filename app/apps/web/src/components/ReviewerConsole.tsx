import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CircleDot,
  Clock,
  HelpCircle,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import {
  claimReviewItem,
  getReviewQueue,
  releaseReviewItem,
  resolveReviewItem,
} from '../api/client';
import type { ResolutionOutcome, ReviewItem, ReviewLifecycle } from '../api/types';

// Color-never-alone: every status tag carries a visible text label, never color alone
// (Req 11.3). Classes reuse the shared .tag palette (muted / info / teal).
const STATUS: Record<ReviewLifecycle, { label: string; cls: string; Icon: typeof Clock }> = {
  pending: { label: 'Pending', cls: 'muted', Icon: Clock },
  in_review: { label: 'In review', cls: 'info', Icon: CircleDot },
  resolved: { label: 'Resolved', cls: 'teal', Icon: ShieldCheck },
};

// The seven framing/evidence-only resolution outcomes (design §3). No value here is a
// truthfulness verdict or a creator-reliability rating (Req 9.1, 9.3) — the static
// neutrality scan (task 11.2) reads these labels.
const OUTCOME_LABELS: Record<ResolutionOutcome, string> = {
  framing_example_confirmed: 'Framing example confirmed',
  framing_example_weak: 'Framing example weak',
  evidence_adequately_cited: 'Evidence adequately cited',
  evidence_overstated: 'Evidence overstated',
  context_gap_noted: 'Context gap noted',
  no_change_needed: 'No change needed',
  needs_further_review: 'Needs further review',
};
const OUTCOMES = Object.keys(OUTCOME_LABELS) as ResolutionOutcome[];

const NOTE_MAX = 2000; // mirror the server's reviewResolutionSchema note bound

// The queue projects intake context only (a dispute reason or a flagged technique); it
// never carries an external review or verdict for the report. Honest absence (Req 9.4):
// surface a labeled "no external review found" state rather than substitute a verdict.
// ponytail: review items carry no external-evidence field by design, so this is constant.
function hasExternalReview(_item: ReviewItem): boolean {
  return false;
}

// 401/403 land here as the server's error token (no client auth flow yet — steering),
// so a review route that is unreachable for auth reasons resolves to the sign-in state.
function isAuthError(message: string): boolean {
  return /auth|reviewer|not_a_reviewer|401|403/i.test(message);
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; items: ReviewItem[] }
  | { kind: 'error'; message: string; signIn: boolean };

export function ReviewerConsole({ onBack }: { onBack?: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  async function load() {
    setPhase({ kind: 'loading' });
    try {
      const items = await getReviewQueue();
      setPhase({ kind: 'ready', items });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase({ kind: 'error', message, signIn: isAuthError(message) });
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replace one item in place after a successful action so the displayed status and
  // assignee reflect the returned state (Req 11.8), leaving the rest of the queue intact.
  function applyUpdate(updated: ReviewItem) {
    setPhase((p) =>
      p.kind === 'ready'
        ? { kind: 'ready', items: p.items.map((it) => (it.id === updated.id ? updated : it)) }
        : p,
    );
  }

  function back() {
    if (onBack) onBack();
    else if (window.location.hash) window.location.hash = '';
  }

  return (
    <div className="review-console">
      <div className="report-head">
        <div>
          <button className="btn btn-ghost" onClick={back} style={{ height: 34, padding: '0 12px' }}>
            <ArrowLeft size={15} /> Back
          </button>
          <h2 className="editorial">Review queue</h2>
          <div className="meta-row">
            <span>Triage, claim, and resolve incoming disputes and flags.</span>
          </div>
        </div>
        <div className="head-actions">
          <button
            className="btn btn-ghost"
            style={{ height: 38, padding: '0 14px', flexShrink: 0 }}
            onClick={() => void load()}
            disabled={phase.kind === 'loading'}
            aria-label="Refresh the review queue"
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {phase.kind === 'loading' && (
        <div className="loading" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="section-label">Loading the review queue…</div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div>
          <div className="banner error" role="alert">
            {phase.signIn
              ? 'You need to be signed in as a reviewer to work the queue. Sign in and try again.'
              : phase.message}
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

      {phase.kind === 'ready' && phase.items.length === 0 && (
        <div className="mini-card" role="status" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          The review queue is empty — there are no disputes or flags awaiting review.
        </div>
      )}

      {phase.kind === 'ready' && phase.items.length > 0 && (
        <ul className="review-list">
          {phase.items.map((item) => (
            <ReviewItemRow key={item.id} item={item} onUpdated={applyUpdate} />
          ))}
        </ul>
      )}
    </div>
  );
}

// One queue row. Owns its own busy/error/resolve-form state so a failed action on one
// item leaves the displayed item unchanged and its controls keyboard-operable for retry
// (Req 11.9), without disturbing sibling rows.
function ReviewItemRow({
  item,
  onUpdated,
}: {
  item: ReviewItem;
  onUpdated: (item: ReviewItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [outcome, setOutcome] = useState<ResolutionOutcome>(OUTCOMES[0]);
  const [note, setNote] = useState('');
  const resolveBtnRef = useRef<HTMLButtonElement>(null);

  const status = STATUS[item.status];
  const headingId = `review-item-${item.id}`;
  const statusId = `review-status-${item.id}`;

  // Run an action; on success swap in the returned item (Req 11.8); on failure keep the
  // item unchanged and surface an inline error, leaving controls operable for retry (Req 11.9).
  async function act(fn: () => Promise<ReviewItem>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await fn();
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onResolve(e: React.FormEvent) {
    e.preventDefault();
    if (note.length > NOTE_MAX) return;
    await act(() => resolveReviewItem(item.id, { outcome, note: note.trim() || undefined }));
    setResolving(false);
    resolveBtnRef.current?.focus();
  }

  return (
    <li className="review-item">
      <div className="review-item-main">
        <div className="review-item-context">
          <span className="tag">{item.kind === 'dispute' ? 'Dispute' : 'Flag'}</span>
          <span className="review-report" id={headingId}>
            Report <code>{item.reportId}</code>
          </span>
        </div>

        {item.kind === 'dispute' ? (
          <div className="review-detail">
            <div className="sub">Dispute reason</div>
            <p>{item.reason ?? '(no reason given)'}</p>
            {item.claimId && <div className="review-meta">Claim: {item.claimId}</div>}
          </div>
        ) : (
          <div className="review-detail">
            <div className="sub">Flagged technique</div>
            <p>{item.technique ?? '(no technique given)'}</p>
            {item.note && <div className="review-meta">Note: {item.note}</div>}
          </div>
        )}

        {/* Honest absence (Req 9.4): visible, text-labeled — never a substitute verdict. */}
        {!hasExternalReview(item) && (
          <p className="review-no-evidence">
            <HelpCircle size={13} aria-hidden="true" /> No external review found
            <span className="sr-only">
              {' '}
              — this queue shows the submitted dispute or flag only; no external review is
              attached to the report.
            </span>
          </p>
        )}
      </div>

      <div className="review-item-side">
        <div className="review-status-line">
          {/* color-never-alone: tag pairs the color with the text label (Req 11.3). */}
          <span className={`tag ${status.cls}`} id={statusId}>
            <status.Icon size={12} aria-hidden="true" /> {status.label}
          </span>
        </div>

        <div className="review-assignee">
          {item.assignedReviewer ? (
            <>
              <UserCheck size={13} aria-hidden="true" /> Assigned to {item.assignedReviewer}
            </>
          ) : (
            <>
              <UserCheck size={13} aria-hidden="true" /> Unassigned
            </>
          )}
        </div>

        <div className="review-actions">
          <button
            type="button"
            className="btn btn-ghost"
            style={{ height: 34, padding: '0 12px' }}
            onClick={() => void act(() => claimReviewItem(item.id))}
            disabled={busy}
            aria-describedby={`${headingId} ${statusId}`}
            aria-label={`Claim review item for report ${item.reportId}`}
          >
            {busy ? 'Working…' : 'Claim'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ height: 34, padding: '0 12px' }}
            onClick={() => void act(() => releaseReviewItem(item.id))}
            disabled={busy}
            aria-describedby={`${headingId} ${statusId}`}
            aria-label={`Release review item for report ${item.reportId}`}
          >
            Release
          </button>
          <button
            ref={resolveBtnRef}
            type="button"
            className="btn btn-ghost"
            style={{ height: 34, padding: '0 12px' }}
            onClick={() => setResolving((r) => !r)}
            disabled={busy}
            aria-expanded={resolving}
            aria-describedby={`${headingId} ${statusId}`}
            aria-label={`Resolve review item for report ${item.reportId}`}
          >
            Resolve
          </button>
        </div>

        {resolving && (
          <form className="review-resolve" onSubmit={onResolve}>
            <label className="modal-label" htmlFor={`outcome-${item.id}`}>
              Resolution outcome
            </label>
            <select
              id={`outcome-${item.id}`}
              className="review-select"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as ResolutionOutcome)}
            >
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABELS[o]}
                </option>
              ))}
            </select>
            <label className="modal-label" htmlFor={`note-${item.id}`}>
              Note (optional)
            </label>
            <textarea
              id={`note-${item.id}`}
              className="modal-textarea"
              value={note}
              maxLength={NOTE_MAX}
              rows={3}
              placeholder="Optional reviewer note about the framing or evidence…"
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="modal-count">
              {note.length}/{NOTE_MAX}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: 34, padding: '0 12px' }}
                onClick={() => setResolving(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn" style={{ height: 34, padding: '0 16px' }} disabled={busy}>
                {busy ? 'Submitting…' : 'Submit resolution'}
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="banner error" role="alert">
            <AlertTriangle size={13} aria-hidden="true" /> {error}
          </div>
        )}
      </div>
    </li>
  );
}
