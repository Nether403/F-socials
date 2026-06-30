// Feature: institutional-workspace, App routing + session/degraded behavior (task 9.2)
// Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 13.4, 13.5, 13.6
//
// Example-based component coverage for the workspace routing and session wiring added
// to App.tsx in task 9.1 — the `#/workspaces` / `#/workspaces/:id` hash routes and the
// gating that chooses between the Workspace_View, the sign-in AuthPanel, and the
// not-configured unavailable message:
//
//   - 13.4 — anonymous + Auth_Configured opening a Workspace_View presents the sign-in
//     flow AND retains the target so a successful sign-in returns the reader to the
//     workspace view (driven through the AuthPanel onSuccess = afterAuthSuccess).
//   - 13.5 — a workspace 401 (AuthExpiredError) is piped to session.handleAuthError so
//     the session is torn down and the app falls back to the Anonymous experience.
//   - 13.6 — a workspace 403 (WorkspaceForbiddenError) renders the access-denied message
//     and no workspace data.
//   - 12.1–12.5 — when not Auth_Configured the Workspace_View shows the
//     features-unavailable message with no create/redeem forms, no request is ever sent,
//     the other views keep working, and boot raises no unhandled error.
//
// Harness (mirrors analytics.consent.test.tsx + the Report.gated fake-session pattern):
// `./auth/useSession` is mocked to return a controllable fake session (the single
// session instance App reads), `./api/client` is mocked for the network calls while
// preserving the real AuthExpiredError / WorkspaceForbiddenError classes (so the
// components' `instanceof` checks and App's session teardown behave as in production),
// `./analytics` is a no-op (consent-gated track has no render effect), and `AuthPanel`
// is replaced with a tiny stand-in that exposes its `onSuccess` callback so the
// post-sign-in return can be driven deterministically. The hash is set before render so
// App's mount-time route resolution sees it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseSession } from './auth/useSession';

// The live fake session App's mocked useSession returns. Held in a hoisted ref so a
// test can flip it (e.g. anonymous → active after sign-in) and re-render to observe the
// transition, mirroring the real setSession-driven re-render.
const sessionRef = vi.hoisted(() => ({ current: null as unknown as UseSession }));
vi.mock('./auth/useSession', () => ({ useSession: () => sessionRef.current }));

// Hoisted vi.fns for every network call the rendered views make, so the factory and the
// assertions share the same instances. Spreading the real module first keeps the real
// AuthExpiredError / WorkspaceForbiddenError classes (identity matters for instanceof).
const api = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  redeemInvite: vi.fn(),
  listMembers: vi.fn(),
  listCollections: vi.fn(),
  getPolicy: vi.fn(),
}));
vi.mock('./api/client', async (orig) => {
  const actual = await orig<typeof import('./api/client')>();
  return { ...actual, ...api };
});

// Analytics is consent-gated and has no render side effects; stub it so neither the SDK
// nor consent storage is touched (the DOM is identical whether it runs or not).
vi.mock('./analytics', () => ({ track: vi.fn(), grantConsent: vi.fn(), hasConsent: () => false }));

// Stand-in AuthPanel: identifies the sign-in flow and exposes onSuccess so the
// post-sign-in return (afterAuthSuccess) can be invoked from a test.
vi.mock('./components/AuthPanel', () => ({
  AuthPanel: ({ onSuccess }: { onSuccess?: () => void }) => (
    <div data-testid="auth-panel">
      <p>mock auth panel</p>
      <button onClick={() => onSuccess?.()}>complete sign-in</button>
    </div>
  ),
}));

import App from './App';
import { LanguageProvider } from './i18n/context';
import { AuthExpiredError, WorkspaceForbiddenError } from './api/client';

// Build a fake UseSession. A token present ⇒ active session (with a reader id);
// otherwise Anonymous. `configured` selects the Auth_Configured-vs-not branch.
// handleAuthError mirrors production: a 401 expiry flips the live session to Anonymous.
function makeSession(
  opts: { token?: string | null; configured?: boolean; loading?: boolean; readerId?: string } = {},
): UseSession {
  const token = opts.token;
  return {
    session: token ? { accessToken: token, reader: { id: opts.readerId ?? 'reader-1' } } : null,
    configured: opts.configured ?? true,
    loading: opts.loading ?? false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    clearSession: vi.fn(),
    handleAuthError: vi.fn((e: unknown) => {
      if (e instanceof AuthExpiredError) sessionRef.current = makeSession({ token: null, configured: true });
    }),
    pendingAction: { current: null },
  } as unknown as UseSession;
}

beforeEach(() => {
  window.location.hash = '';
  api.listWorkspaces.mockReset().mockResolvedValue([]);
  api.createWorkspace.mockReset();
  api.redeemInvite.mockReset();
  api.listMembers.mockReset().mockResolvedValue([]);
  api.listCollections.mockReset().mockResolvedValue([]);
  api.getPolicy.mockReset().mockRejectedValue(new Error('policy down'));
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

// --- 13.4: anonymous + configured → sign-in with retained target ------------

describe('Workspace routing — anonymous + Auth_Configured (Req 13.4)', () => {
  it('presents the sign-in flow and returns to the Workspace_View after signing in', async () => {
    sessionRef.current = makeSession({ token: null, configured: true });
    window.location.hash = '#/workspaces';
    const { rerender } = render(<LanguageProvider><App /></LanguageProvider>);
    const user = userEvent.setup();

    // The sign-in flow is presented (not the workspace list) for an anonymous reader
    // who opened a Workspace_View while configured.
    expect(await screen.findByTestId('auth-panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create workspace/i })).not.toBeInTheDocument();
    // No workspace request is issued while anonymous.
    expect(api.listWorkspaces).not.toHaveBeenCalled();

    // Complete the sign-in: afterAuthSuccess must retain the workspace target rather
    // than navigating home — the hash stays on the workspace route.
    await user.click(screen.getByRole('button', { name: /complete sign-in/i }));
    expect(window.location.hash).toBe('#/workspaces');

    // The session is now active; a re-render (the real session transition would trigger
    // one) shows the reader back on the Workspace_View, which loads their workspaces.
    sessionRef.current = makeSession({ token: 'tok-1', configured: true });
    rerender(<LanguageProvider><App /></LanguageProvider>);

    expect(await screen.findByRole('button', { name: /create workspace/i })).toBeInTheDocument();
    expect(screen.queryByTestId('auth-panel')).not.toBeInTheDocument();
    await waitFor(() => expect(api.listWorkspaces).toHaveBeenCalledWith('tok-1'));
  });
});

// --- 13.5: workspace 401 → session torn down, Anonymous experience ----------

describe('Workspace routing — 401 falls back to Anonymous (Req 13.5)', () => {
  it('pipes a workspace 401 to session.handleAuthError and presents the Anonymous experience', async () => {
    const active = makeSession({ token: 'tok-401', configured: true });
    sessionRef.current = active;
    api.listWorkspaces.mockRejectedValue(new AuthExpiredError());
    window.location.hash = '#/workspaces';
    const { rerender } = render(<LanguageProvider><App /></LanguageProvider>);

    // The workspace 401 is routed through the session layer so the session is cleared.
    await waitFor(() => expect(active.handleAuthError).toHaveBeenCalledTimes(1));
    expect(active.handleAuthError).toHaveBeenCalledWith(expect.any(AuthExpiredError));

    // handleAuthError flipped the live session to Anonymous; re-rendering presents the
    // Anonymous experience (the sign-in flow on this gated route).
    rerender(<LanguageProvider><App /></LanguageProvider>);
    expect(await screen.findByTestId('auth-panel')).toBeInTheDocument();
  });
});

// --- 13.6: workspace 403 → access message, no data -------------------------

describe('Workspace routing — 403 access denied (Req 13.6)', () => {
  it('renders the access-denied message and no workspace data on a 403', async () => {
    sessionRef.current = makeSession({ token: 'tok-403', configured: true, readerId: 'reader-1' });
    api.listMembers.mockRejectedValue(new WorkspaceForbiddenError());
    api.listCollections.mockRejectedValue(new WorkspaceForbiddenError());
    window.location.hash = '#/workspaces/ws-secret';
    render(<LanguageProvider><App /></LanguageProvider>);

    expect(await screen.findByText(/do not have access to this workspace/i)).toBeInTheDocument();
    // No workspace data is shown: neither the members nor the collections sections render.
    expect(screen.queryByText(/^Members \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Collections \(/)).not.toBeInTheDocument();
  });
});

// --- 12.1–12.5: not Auth_Configured degraded behavior -----------------------

describe('Workspace routing — not Auth_Configured (Req 12.1–12.5)', () => {
  it('shows the unavailable message, no create/redeem forms, and sends no request (Req 12.1, 12.3)', async () => {
    sessionRef.current = makeSession({ token: null, configured: false });
    window.location.hash = '#/workspaces';
    render(<LanguageProvider><App /></LanguageProvider>);

    expect(await screen.findByText(/workspace features are unavailable/i)).toBeInTheDocument();
    // No workspace/collection/annotation control is rendered, so none can be activated;
    // combined with no request being issued this satisfies "activation sends nothing and
    // leaves the view unchanged" (Req 12.3).
    expect(screen.queryByRole('button', { name: /create workspace/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /new workspace name/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /redeem invite/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /invite code/i })).not.toBeInTheDocument();
    expect(api.listWorkspaces).not.toHaveBeenCalled();
    expect(api.createWorkspace).not.toHaveBeenCalled();
  });

  it('boots to the home view without an unhandled error when not configured (Req 12.4)', () => {
    sessionRef.current = makeSession({ token: null, configured: false });
    expect(() => render(<LanguageProvider><App /></LanguageProvider>)).not.toThrow();
    expect(screen.getByRole('heading', { name: /inspect before you react/i })).toBeInTheDocument();
  });

  it('keeps the other views working while not configured (Req 12.2, 12.5)', async () => {
    sessionRef.current = makeSession({ token: null, configured: false });
    render(<LanguageProvider><App /></LanguageProvider>);

    // Home renders and responds.
    expect(screen.getByRole('heading', { name: /inspect before you react/i })).toBeInTheDocument();

    // Navigating to the methodology view still works (it degrades its own policy fetch).
    await act(async () => {
      window.location.hash = '#/methodology';
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(await screen.findByRole('heading', { name: /how f-socials works/i })).toBeInTheDocument();

    // Switching to the workspace surface shows the unavailable message, leaving the rest
    // of the app intact.
    await act(async () => {
      window.location.hash = '#/workspaces';
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(await screen.findByText(/workspace features are unavailable/i)).toBeInTheDocument();

    // And the reader can return home through the Back control (the home view responds
    // to interaction even while not configured).
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(await screen.findByRole('heading', { name: /inspect before you react/i })).toBeInTheDocument();
  });
});
