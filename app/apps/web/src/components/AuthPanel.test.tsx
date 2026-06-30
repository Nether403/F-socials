// Feature: accounts-save-history, auth surface component tests (task 9.3)
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7,
//            3.1, 3.2, 3.3, 3.5, 4.1, 5.1, 14.2, 14.4, 14.8, 14.9
//
// jsdom + React Testing Library + vitest-axe. The auth surface is exercised through
// a tiny <Harness> that wires the real `useSession` hook to an injected FAKE
// AuthClient, then renders <AuthPanel> against the resulting session — so the same
// session machinery the app uses drives the panel, but no network/SDK is touched.
// Sign-out and session-restore are useSession transitions (the panel has no sign-out
// control of its own), so those are asserted through `renderHook(useSession)`.
// The 30s sign-in/sign-up timeout is verified with fake timers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  renderHook,
  act,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import { AuthPanel } from './AuthPanel';
import { LanguageProvider } from '../i18n/context';
import { useSession } from '../auth/useSession';
import {
  AuthTimeoutError,
  type AuthClient,
  type Session,
} from '../auth/authClient';

expect.extend(axeMatchers);

// --- Fakes & helpers --------------------------------------------------------

const VALID_EMAIL = 'user@example.com';
const VALID_PASSWORD = 'password123';

const SESSION: Session = {
  accessToken: 'access-token-1',
  reader: { id: 'reader-1', email: VALID_EMAIL },
};

// A controllable promise so a test can hold an auth call "in flight" and resolve
// or reject it at a chosen moment.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeOptions {
  configured?: boolean;
  initialSession?: Session | null;
  signUp?: (email: string, password: string) => Promise<Session>;
  signIn?: (email: string, password: string) => Promise<Session>;
  signOut?: () => Promise<void>;
}

interface FakeAuthClient extends AuthClient {
  calls: { signUp: number; signIn: number; signOut: number };
  emit(s: Session | null): void;
}

// A fake AuthClient honoring the seam contract: getSession restores an optional
// initial session, signUp/signIn/signOut delegate to injected impls (default:
// resolve to a fixed session), onChange registers a listener that `emit` drives.
function makeFakeAuthClient(opts: FakeOptions = {}): FakeAuthClient {
  const listeners = new Set<(s: Session | null) => void>();
  const calls = { signUp: 0, signIn: 0, signOut: 0 };
  return {
    configured: opts.configured ?? true,
    async getSession() {
      return opts.initialSession ?? null;
    },
    async signUp(email, password) {
      calls.signUp++;
      return (opts.signUp ?? (async () => SESSION))(email, password);
    },
    async signIn(email, password) {
      calls.signIn++;
      return (opts.signIn ?? (async () => SESSION))(email, password);
    },
    async signOut() {
      calls.signOut++;
      if (opts.signOut) await opts.signOut();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    calls,
    emit(s) {
      listeners.forEach((cb) => cb(s));
    },
  };
}

// Wire the real useSession to the injected fake and render the panel against it.
function Harness({ client, onSuccess }: { client: AuthClient; onSuccess?: () => void }) {
  const session = useSession(client);
  return <AuthPanel session={session} onSuccess={onSuccess} />;
}

function renderPanel(client: AuthClient, onSuccess?: () => void) {
  return render(<LanguageProvider><Harness client={client} onSuccess={onSuccess} /></LanguageProvider>);
}

// Fill the email + password fields with valid credentials (real-timer tests).
async function fillValidCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/email/i), VALID_EMAIL);
  await user.type(screen.getByLabelText(/password/i), VALID_PASSWORD);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Sign in ----------------------------------------------------------------

describe('AuthPanel — sign in', () => {
  // 2.1, 2.2 — submitting valid credentials requests a session and, on success,
  // establishes the session (signIn invoked) and notifies the parent to route on.
  it('requests a session and establishes it on success', async () => {
    const user = userEvent.setup();
    const client = makeFakeAuthClient();
    const onSuccess = vi.fn();
    renderPanel(client, onSuccess);

    await fillValidCredentials(user);
    await user.click(within(screen.getByRole('form', { name: /sign in/i })).getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(client.calls.signIn).toBe(1);
    expect(client.calls.signUp).toBe(0);
  });

  // 2.3 — a rejected credential set shows an authentication-failed message, leaves
  // the reader anonymous (no onSuccess), retains the submitted email, and re-enables.
  it('shows the rejection reason, retains the email, and stays anonymous on failure', async () => {
    const user = userEvent.setup();
    const client = makeFakeAuthClient({
      signIn: () => Promise.reject(new Error('Invalid login credentials')),
    });
    const onSuccess = vi.fn();
    renderPanel(client, onSuccess);

    await fillValidCredentials(user);
    const submit = within(screen.getByRole('form', { name: /sign in/i })).getByRole('button', { name: /sign in/i });
    await user.click(submit);

    expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    // Email retained (Req 2.3); password cleared; submit re-enabled (Req 2.5).
    expect(screen.getByLabelText(/email/i)).toHaveValue(VALID_EMAIL);
    expect(screen.getByLabelText(/password/i)).toHaveValue('');
    expect(submit).not.toBeDisabled();
  });

  // 2.4 — while a sign-in is in flight the submit control is disabled; 2.5 — it is
  // re-enabled once the call resolves.
  it('disables the submit control while in flight and re-enables it after success', async () => {
    const user = userEvent.setup();
    const d = deferred<Session>();
    const client = makeFakeAuthClient({ signIn: () => d.promise });
    const onSuccess = vi.fn();
    renderPanel(client, onSuccess);

    await fillValidCredentials(user);
    const submit = within(screen.getByRole('form', { name: /sign in/i })).getByRole('button', { name: /sign in/i });
    await user.click(submit);

    // In flight: disabled with the pending label.
    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit).toHaveTextContent(/signing in/i);

    // Resolve the held call: re-enabled and parent notified.
    await act(async () => {
      d.resolve(SESSION);
    });
    await waitFor(() => expect(submit).not.toBeDisabled());
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  // 2.6 — client-side validation rejects a malformed email, shows a message, and
  // sends no request.
  it('blocks an invalid email with a validation message and sends no request', async () => {
    const user = userEvent.setup();
    const client = makeFakeAuthClient();
    renderPanel(client);

    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/password/i), VALID_PASSWORD);
    await user.click(within(screen.getByRole('form', { name: /sign in/i })).getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(client.calls.signIn).toBe(0);
  });
});

// --- Sign up ----------------------------------------------------------------

describe('AuthPanel — sign up', () => {
  // 1.1, 1.2 — switching to the create-account tab and submitting valid credentials
  // requests account creation and, on success, establishes the session.
  it('requests account creation and establishes the session on success', async () => {
    const user = userEvent.setup();
    const client = makeFakeAuthClient();
    const onSuccess = vi.fn();
    renderPanel(client, onSuccess);

    await user.click(screen.getByRole('button', { name: /create account/i }));
    const form = screen.getByRole('form', { name: /create account/i });
    await user.type(within(form).getByLabelText(/email/i), VALID_EMAIL);
    await user.type(within(form).getByLabelText(/password/i), VALID_PASSWORD);
    await user.click(within(form).getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(client.calls.signUp).toBe(1);
  });

  // 1.3 — a rejected sign-up shows the reason, stays anonymous, and re-enables.
  it('shows the rejection reason and stays anonymous on failure', async () => {
    const user = userEvent.setup();
    const client = makeFakeAuthClient({
      signUp: () => Promise.reject(new Error('User already registered')),
    });
    const onSuccess = vi.fn();
    renderPanel(client, onSuccess);

    await user.click(screen.getByRole('button', { name: /create account/i }));
    const form = screen.getByRole('form', { name: /create account/i });
    await user.type(within(form).getByLabelText(/email/i), VALID_EMAIL);
    await user.type(within(form).getByLabelText(/password/i), VALID_PASSWORD);
    const submit = within(form).getByRole('button', { name: /create account/i });
    await user.click(submit);

    expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(submit).not.toBeDisabled();
  });

  // 1.4 — the submit control is disabled while a sign-up is in flight.
  it('disables the submit control while a sign-up is in flight', async () => {
    const user = userEvent.setup();
    const d = deferred<Session>();
    const client = makeFakeAuthClient({ signUp: () => d.promise });
    renderPanel(client);

    await user.click(screen.getByRole('button', { name: /create account/i }));
    const form = screen.getByRole('form', { name: /create account/i });
    await user.type(within(form).getByLabelText(/email/i), VALID_EMAIL);
    await user.type(within(form).getByLabelText(/password/i), VALID_PASSWORD);
    const submit = within(form).getByRole('button', { name: /create account/i });
    await user.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit).toHaveTextContent(/creating account/i);

    await act(async () => {
      d.resolve(SESSION);
    });
    await waitFor(() => expect(submit).not.toBeDisabled());
  });
});

// --- Timeout (fake timers) --------------------------------------------------

describe('AuthPanel — 30s timeout', () => {
  // 2.7 — a sign-in that does not resolve within 30s surfaces a service-unavailable
  // message and re-enables the control. Driven by fake timers + an AuthTimeoutError.
  it('surfaces a timeout/unavailable message after 30s and re-enables (sign in)', async () => {
    vi.useFakeTimers();
    const client = makeFakeAuthClient({
      signIn: () =>
        new Promise<Session>((_, reject) => {
          setTimeout(() => reject(new AuthTimeoutError()), 30_000);
        }),
    });
    renderPanel(client);

    const form = screen.getByRole('form', { name: /sign in/i });
    fireEvent.change(within(form).getByLabelText(/email/i), { target: { value: VALID_EMAIL } });
    fireEvent.change(within(form).getByLabelText(/password/i), { target: { value: VALID_PASSWORD } });
    const submit = within(form).getByRole('button', { name: /sign in/i });
    fireEvent.click(submit);

    // In flight: disabled.
    expect(submit).toBeDisabled();

    // Advance to the deadline; the racing AuthTimeoutError rejects the call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
    expect(submit).not.toBeDisabled();
  });

  // 1.8 — a sign-up timeout reports a timeout message and re-enables.
  it('surfaces a timeout message after 30s and re-enables (sign up)', async () => {
    vi.useFakeTimers();
    const client = makeFakeAuthClient({
      signUp: () =>
        new Promise<Session>((_, reject) => {
          setTimeout(() => reject(new AuthTimeoutError()), 30_000);
        }),
    });
    renderPanel(client);

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    const form = screen.getByRole('form', { name: /create account/i });
    fireEvent.change(within(form).getByLabelText(/email/i), { target: { value: VALID_EMAIL } });
    fireEvent.change(within(form).getByLabelText(/password/i), { target: { value: VALID_PASSWORD } });
    const submit = within(form).getByRole('button', { name: /create account/i });
    fireEvent.click(submit);

    expect(submit).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
    expect(submit).not.toBeDisabled();
  });
});

// --- useSession transitions: restore & sign out -----------------------------

describe('useSession — restore and sign out (drives the auth surface)', () => {
  // 4.1 — a stored session is restored on load and the authenticated experience is
  // presented (session becomes non-null once restore resolves).
  it('restores a persisted session on load', async () => {
    const client = makeFakeAuthClient({ initialSession: SESSION });
    const { result } = renderHook(() => useSession(client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toEqual(SESSION);
  });

  // 3.1, 3.2, 3.3 — sign out ends the session: the call is made and the local
  // session is cleared so the anonymous experience is presented.
  it('ends the session on sign out', async () => {
    const client = makeFakeAuthClient({ initialSession: SESSION });
    const { result } = renderHook(() => useSession(client));
    await waitFor(() => expect(result.current.session).toEqual(SESSION));

    await act(async () => {
      await result.current.signOut();
    });

    expect(client.calls.signOut).toBe(1);
    expect(result.current.session).toBeNull();
  });

  // 3.5 — if the remote sign-out fails, the local session is still discarded (the
  // anonymous experience is presented) and the error is rethrown so the UI can warn.
  it('discards the local session even when remote sign out fails', async () => {
    const client = makeFakeAuthClient({
      initialSession: SESSION,
      signOut: () => Promise.reject(new Error('network down')),
    });
    const { result } = renderHook(() => useSession(client));
    await waitFor(() => expect(result.current.session).toEqual(SESSION));

    await act(async () => {
      await expect(result.current.signOut()).rejects.toThrow(/network down/i);
    });

    expect(result.current.session).toBeNull();
  });
});

// --- Not configured (degraded) ----------------------------------------------

describe('AuthPanel — not configured', () => {
  // 5.1 — when not Auth_Configured the panel shows the unavailable message and
  // renders NO form (no email/password fields, no submit).
  it('renders the unavailable message and no form', () => {
    const client = makeFakeAuthClient({ configured: false });
    renderPanel(client);

    expect(screen.getByText(/account features are unavailable/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
  });
});

// --- Accessibility ----------------------------------------------------------

describe('AuthPanel — accessibility', () => {
  // 14.2/14.4/14.8/14.9 — accessible name + role on every interactive control, an
  // ARIA live region for status, and no WCAG A/AA ARIA-wiring violations.
  it('exposes accessible names/roles, an ARIA live region, and passes an axe scan', async () => {
    const client = makeFakeAuthClient();
    const { container } = renderPanel(client);

    // The form has an accessible name; email is a labeled textbox; password is a
    // labeled field; the submit button has an accessible name (Req 14.2, 14.4).
    const form = screen.getByRole('form', { name: /sign in/i });
    expect(within(form).getByRole('textbox', { name: /email/i })).toBeInTheDocument();
    expect(within(form).getByLabelText(/password/i)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    // Mode toggles are labeled, role'd buttons.
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();

    // A persistent ARIA live region is present so status is announced (Req 14.9).
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // jsdom cannot measure real pixel contrast, so color-contrast is excluded and
    // covered by the CSS-variable audit + manual review (matches a11ySmoke.test).
    const results = await axe(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results).toHaveNoViolations();
  });
});
