import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { submitDispute } from '../api/client';
import { track } from '../analytics';
import { useT } from '../i18n/context';

const MAX = 2000; // mirror the server's disputeSchema reason bound (1..2000)

// Elements that can hold keyboard focus, used to trap Tab within the dialog (4.7).
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Anonymous dispute intake (Req 3.8, 3.9). claimId is optional and pre-filled when
// the opener targets a specific claim; on success we swap to a confirmation, on
// failure we keep the modal open with an inline error so the user can retry.
// Keyboard/focus (4.7): on open we move focus into the dialog, Tab/Shift+Tab cycle
// within it, and Escape closes — focus restore to the opener is the caller's onClose.
export function DisputeModal({
  reportId,
  claimId,
  onClose,
}: {
  reportId: string;
  claimId?: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const { t } = useT();

  // Move focus into the dialog on open and whenever the body swaps (form ⇄ confirmation),
  // trap Tab within it, and close on Escape (4.7). The opener-focus restore lives in onClose.
  useEffect(() => {
    const node = modalRef.current;
    if (!node) return;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!node.contains(document.activeElement)) focusables()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !node!.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node!.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [onClose, done]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= MAX;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitDispute(reportId, { reason: trimmed, claimId });
      track('dispute', { reportId }); // Web_Analytics interaction event (Req 12.2)
      setDone(true);
    } catch (err) {
      // Inline error, modal stays open so the user can retry (3.9 failure path).
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispute-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="dispute-title" className="editorial">
            {t('dispute.title')}
          </h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('dispute.close')}>
            <X size={16} />
          </button>
        </div>

        {done ? (
          <div>
            <div className="banner" role="status">
              {t('dispute.received')}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>
                {t('dispute.closeBtn')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="modal-note">
              {t('dispute.note')}
            </p>
            <label className="modal-label" htmlFor="dispute-reason">
              {t('dispute.label')}
            </label>
            <textarea
              id="dispute-reason"
              className="modal-textarea"
              value={reason}
              maxLength={MAX}
              rows={5}
              placeholder={t('dispute.placeholder')}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
            />
            <div className="modal-count">
              {trimmed.length}/{MAX}
            </div>
            {error && (
              <div className="banner error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                {t('dispute.cancel')}
              </button>
              <button type="submit" className="btn" disabled={!valid || submitting}>
                {submitting ? t('dispute.submitting') : t('dispute.submit')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
