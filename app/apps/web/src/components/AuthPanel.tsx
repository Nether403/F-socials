import { useState, type FormEvent } from 'react';
import { Info, LogIn, UserPlus } from 'lucide-react';
import {
  AuthTimeoutError,
  AuthUnavailableError,
  validateCredentials,
} from '../auth/authClient';
import type { UseSession } from '../auth/useSession';
import { useT } from '../i18n/context';

type Mode = 'sign-in' | 'sign-up';

// Turn whatever the AuthClient threw into a reader-facing message. Supabase
// rejections carry their reason on error.message (Req 1.3, 2.3); a timeout on
// sign-up reports a timeout (Req 1.8) while a sign-in timeout/unreachable reports
// the service is unavailable (Req 2.7).
function messageFor(err: unknown, mode: Mode): string {
  if (err instanceof AuthTimeoutError) {
    return mode === 'sign-up'
      ? 'The request timed out. Please try again.'
      : 'The authentication service is unavailable right now. Please try again.';
  }
  if (err instanceof AuthUnavailableError) {
    return 'Account features are unavailable right now.';
  }
  if (err instanceof Error && err.message) return err.message;
  return mode === 'sign-up' ? 'Could not create your account.' : 'Could not sign you in.';
}

// The sign-in / sign-up surface (Req 1, 2, 5.1, 14). It reads the shared session
// hook for `configured` + `signIn`/`signUp`; the parent owns the single useSession
// instance and decides where to go after a successful auth via `onSuccess`.
//
// Accessibility: native <form>/<label>/<input>/<button> keep every control keyboard
// reachable and activatable (Req 14.2) with an accessible name + role (Req 14.4);
// status/error text lives in a persistent ARIA live region so it is announced
// without a focus change (Req 14.9); visible focus is provided by CSS (Req 14.8).
export function AuthPanel({
  session,
  onSuccess,
}: {
  session: UseSession;
  onSuccess?: () => void;
}) {
  const { t } = useT();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Not Auth_Configured: show the unavailable message and render NO form (Req 5.1).
  if (!session.configured) {
    return (
      <div className="card auth-card">
        <div className="section-label">{t('signIn.heading')}</div>
        <div className="banner" role="status">
          <Info size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          {t('signIn.unavailable')}
        </div>
      </div>
    );
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    // Client-side validation gate: on rejection show a message and send nothing
    // (Req 1.5, 1.6, 1.7, 2.6).
    const check = validateCredentials(email, password);
    if (!check.valid) {
      setError(check.message ?? 'Please check your details.');
      return;
    }

    setSubmitting(true); // disable the submit control while in flight (Req 1.4, 2.4)
    setError(null);
    try {
      if (mode === 'sign-up') await session.signUp(email, password);
      else await session.signIn(email, password);
      // Session established by useSession; drop the password and let the parent
      // route on (Req 1.2, 2.2).
      setPassword('');
      onSuccess?.();
    } catch (err) {
      // Stay Anonymous, surface the reason, retain the submitted email (Req 1.3,
      // 2.3); clear only the password.
      setError(messageFor(err, mode));
      setPassword('');
    } finally {
      // Re-enable the submit control on any outcome (Req 1.2, 1.3, 2.5).
      setSubmitting(false);
    }
  }

  const submitLabel = submitting
    ? mode === 'sign-up'
      ? t('signIn.submittingSignUp')
      : t('signIn.submittingSignIn')
    : mode === 'sign-up'
      ? t('signIn.submitSignUp')
      : t('signIn.submitSignIn');

  return (
    <div className="card auth-card">
      <div className="auth-modes" role="group" aria-label={t('signIn.groupLabel')}>
        <button
          type="button"
          className={`tab ${mode === 'sign-in' ? 'active' : ''}`}
          aria-pressed={mode === 'sign-in'}
          onClick={() => switchMode('sign-in')}
        >
          <LogIn size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          {t('signIn.tabSignIn')}
        </button>
        <button
          type="button"
          className={`tab ${mode === 'sign-up' ? 'active' : ''}`}
          aria-pressed={mode === 'sign-up'}
          onClick={() => switchMode('sign-up')}
        >
          <UserPlus size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          {t('signIn.tabSignUp')}
        </button>
      </div>

      <form onSubmit={onSubmit} noValidate aria-label={mode === 'sign-up' ? t('signIn.submitSignUp') : t('signIn.submitSignIn')}>
        <div className="auth-field">
          <label className="modal-label" htmlFor="auth-email">
            {t('signIn.email')}
          </label>
          <input
            id="auth-email"
            className="auth-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="auth-field">
          <label className="modal-label" htmlFor="auth-password">
            {t('signIn.password')}
          </label>
          <input
            id="auth-password"
            className="auth-input"
            type="password"
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {/* Persistent ARIA live region: announces validation/auth errors without a
            focus change (Req 14.9). role="alert" implies aria-live="assertive". */}
        <div aria-live="assertive" role="alert">
          {error && <div className="banner error">{error}</div>}
        </div>

        <button type="submit" className="btn auth-submit" disabled={submitting}>
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
