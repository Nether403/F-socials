// Feature: accounts-save-history, gated Flag/Save control component tests (task 11.3)
// Validates: Requirements 5.3, 6.1, 6.2, 6.5, 6.6, 6.7, 7.1, 7.2, 7.6, 7.7, 14.3
//
// jsdom + React Testing Library + vitest. Report's Save/Flag controls are exercised
// against a FAKE UseSession object (active session with token, anonymous+configured,
// and not-configured) rather than mounting the real useSession hook — matching the
// inject-a-fake pattern used by AuthPanel.test.tsx. The api/client module is mocked
// for saveReport/submitFlag while keeping the real AuthExpiredError class so Report's
// `instanceof` 401 branch still type-checks against the value it imports.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '../i18n/context';
import { Report } from './Report';
import type { AnalysisReport } from '../api/types';
import type { UseSession, PendingGatedAction } from '../auth/useSession';

// Hoisted spies so the assertions reference the same vi.fn instances Report calls.
// importActual keeps AuthExpiredError (a real class used with `instanceof`) intact.
const api = vi.hoisted(() => ({
  saveReport: vi.fn<(reportId: string, token: string) => Promise<void>>(),
  submitFlag: vi.fn<(reportId: string, body: { technique: string }, token?: string) => Promise<void>>(),
}));

vi.mock('../api/client', async (importActual) => {
  const actual = await importActual<typeof import('../api/client')>();
  return { ...actual, saveReport: api.saveReport, submitFlag: api.submitFlag };
});

// A controllable promise so a test can hold a save/flag "in flight" and resolve or
// reject it at a chosen moment (debounce + in-flight-disable scenarios).
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A minimal UseSession-shaped fake. `token` present ⇒ active session; otherwise
// Anonymous, with `configured` selecting the configured-vs-not-configured branch.
// pendingAction is a plain ref object, exactly what Report writes through.
function makeSession(opts: { token?: string | null; configured?: boolean } = {}): UseSession {
  const pendingAction = { current: null as PendingGatedAction | null };
  return {
    session: opts.token ? { accessToken: opts.token, reader: { id: 'reader-1', email: 'a@b.co' } } : null,
    configured: opts.configured ?? false,
    loading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    clearSession: vi.fn(),
    handleAuthError: vi.fn(),
    pendingAction,
  };
}

// One framing signal so the Flag control exists; provenance omitted (not needed).
const fakeReport: AnalysisReport = {
  id: 'report-abc',
  status: 'ready',
  version: 1,
  producingLayer: 'L2',
  title: 'Test analysis',
  claims: [],
  framingSignals: [
    { technique: 'Loaded language', severity: 'medium', description: 'Charged wording.', examples: [] },
  ],
  contextCards: [],
  perspectives: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const TOKEN = 'access-token-1';

// Open the (collapsed-by-default) Framing Signals drawer so the Flag control mounts.
// The signal card wrapper is itself role="button" and contains the flag text, so the
// inner control is matched by its exact label to disambiguate the two.
async function openFraming(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /framing signals/i }));
  return screen.getByRole('button', { name: /^flag this technique$/i });
}

beforeEach(() => {
  api.saveReport.mockReset().mockResolvedValue(undefined);
  api.submitFlag.mockReset().mockResolvedValue(undefined);
});

// --- Active session ---------------------------------------------------------

describe('Report gated Save — active session', () => {
  // 6.1, 7.1 — with a Session active the Save control is enabled and sends the
  // access token to the save call. 7.2, 14.3 — success flips to a "Saved" text
  // label beside the icon (color/icon-never-alone) and aria-pressed.
  it('saves and shows the "Saved" text label, sending the token', async () => {
    const user = userEvent.setup();
    const session = makeSession({ token: TOKEN, configured: true });
    const onRequireSignIn = vi.fn();
    render(<LanguageProvider><Report report={fakeReport} onBack={() => {}} session={session} onRequireSignIn={onRequireSignIn} /></LanguageProvider>);

    const save = screen.getByRole('button', { name: /save/i });
    expect(save).not.toBeDisabled();
    await user.click(save);

    await waitFor(() => expect(api.saveReport).toHaveBeenCalledTimes(1));
    expect(api.saveReport).toHaveBeenCalledWith('report-abc', TOKEN);
    // Visible "Saved" text label (not color/icon alone) + pressed state (Req 7.2, 14.3).
    const saved = await screen.findByRole('button', { name: /saved/i });
    expect(saved).toHaveTextContent(/saved/i);
    expect(saved).toHaveAttribute('aria-pressed', 'true');
    expect(onRequireSignIn).not.toHaveBeenCalled();
  });

  // 7.6 — re-activations while a save is in flight are ignored (debounce): only one
  // request goes out and the control is disabled with the pending label meanwhile.
  it('debounces extra activations while a save is in flight', async () => {
    const user = userEvent.setup();
    const d = deferred<void>();
    api.saveReport.mockReturnValue(d.promise);
    const session = makeSession({ token: TOKEN, configured: true });
    render(<LanguageProvider><Report report={fakeReport} onBack={() => {}} session={session} /></LanguageProvider>);

    const save = screen.getByRole('button', { name: /save/i });
    await user.click(save);
    await waitFor(() => expect(save).toBeDisabled());
    expect(save).toHaveTextContent(/saving/i);

    // Extra activations during the in-flight window are no-ops.
    await user.click(save);
    await user.click(save);
    expect(api.saveReport).toHaveBeenCalledTimes(1);

    d.resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument());
  });

  // 7.7 — a failed save shows "save did not complete", does not show the saved
  // indicator, and re-enables the control for retry.
  it('shows "save did not complete" and re-enables on failure', async () => {
    const user = userEvent.setup();
    api.saveReport.mockRejectedValue(new Error('network down'));
    const session = makeSession({ token: TOKEN, configured: true });
    render(<LanguageProvider><Report report={fakeReport} onBack={() => {}} session={session} /></LanguageProvider>);

    const save = screen.getByRole('button', { name: /save/i });
    await user.click(save);

    expect(await screen.findByText(/save did not complete/i)).toBeInTheDocument();
    // Not saved; re-enabled for retry (still labeled "Save", not "Saved").
    expect(save).not.toBeDisabled();
    expect(save).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /^saved$/i })).toBeNull();
  });
});

// --- Anonymous + configured -------------------------------------------------

describe('Report gated controls — anonymous + configured', () => {
  // 6.2, 6.7 — Save while anonymous (configured) records the pending gated action
  // ({ reportId, control }) and redirects to sign-in, sending no save request.
  it('Save records pending intent and redirects to sign-in', async () => {
    const user = userEvent.setup();
    const session = makeSession({ token: null, configured: true });
    const onRequireSignIn = vi.fn();
    render(<LanguageProvider><Report report={fakeReport} onBack={() => {}} session={session} onRequireSignIn={onRequireSignIn} /></LanguageProvider>);

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onRequireSignIn).toHaveBeenCalledTimes(1);
    expect(session.pendingAction.current).toEqual({ reportId: 'report-abc', control: 'save' });
    expect(api.saveReport).not.toHaveBeenCalled();
  });

  // 6.2, 6.7 — Flag while anonymous (configured) records the pending control as
  // 'flag' and redirects to sign-in, sending no flag request.
  it('Flag records pending intent and redirects to sign-in', async () => {
    const user = userEvent.setup();
    const session = makeSession({ token: null, configured: true });
    const onRequireSignIn = vi.fn();
    render(<LanguageProvider><Report report={fakeReport} onBack={() => {}} session={session} onRequireSignIn={onRequireSignIn} /></LanguageProvider>);

    const flag = await openFraming(user);
    await user.click(flag);

    expect(onRequireSignIn).toHaveBeenCalledTimes(1);
    expect(session.pendingAction.current).toEqual({ reportId: 'report-abc', control: 'flag' });
    expect(api.submitFlag).not.toHaveBeenCalled();
  });
});

// --- Not configured ---------------------------------------------------------

describe('Report gated controls — not configured', () => {
  // 5.3 — activating Save when account features are not configured shows the
  // unavailable message, sends no request, and triggers no sign-in redirect.
  it('Save shows the unavailable message and sends nothing', async () => {
    const user = userEvent.setup();
    const session = makeSession({ token: null, configured: false });
    const onRequireSignIn = vi.fn();
    render(<LanguageProvider><Report report={fakeReport} onBack={() => {}} session={session} onRequireSignIn={onRequireSignIn} /></LanguageProvider>);

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/account features are unavailable/i)).toBeInTheDocument();
    expect(api.saveReport).not.toHaveBeenCalled();
    expect(onRequireSignIn).not.toHaveBeenCalled();
    expect(session.pendingAction.current).toBeNull();
  });
});

// --- Flag in-flight + failure -----------------------------------------------

describe('Report gated Flag — active session', () => {
  // 6.5 — while a flag request is in flight the activated control is disabled and
  // shows the pending label; 7.1/6.3 — the token is attached on send.
  it('disables the activated flag control while in flight and sends the token', async () => {
    const user = userEvent.setup();
    const d = deferred<void>();
    api.submitFlag.mockReturnValue(d.promise);
    const session = makeSession({ token: TOKEN, configured: true });
    render(<LanguageProvider><Report report={fakeReport} onBack={() => {}} session={session} /></LanguageProvider>);

    const flag = await openFraming(user);
    await user.click(flag);

    await waitFor(() => expect(flag).toBeDisabled());
    expect(flag).toHaveTextContent(/flagging/i);
    expect(api.submitFlag).toHaveBeenCalledWith('report-abc', { technique: 'Loaded language' }, TOKEN);

    d.resolve();
    await waitFor(() => expect(flag).not.toBeDisabled());
  });

  // 6.6 — a failed flag shows "action was not recorded" and re-enables the control.
  it('shows "action was not recorded" and re-enables on failure', async () => {
    const user = userEvent.setup();
    api.submitFlag.mockRejectedValue(new Error('network down'));
    const session = makeSession({ token: TOKEN, configured: true });
    render(<LanguageProvider><Report report={fakeReport} onBack={() => {}} session={session} /></LanguageProvider>);

    const flag = await openFraming(user);
    await user.click(flag);

    expect(await screen.findByText(/was not recorded/i)).toBeInTheDocument();
    expect(flag).not.toBeDisabled();
  });
});
