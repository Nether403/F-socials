// Session state for the web accounts experience (Slice 2).
//
// This hook owns the live `Session | null` and is the single place the rest of
// the app reads authentication state from. It wraps the AuthClient seam
// (authClient.ts) — which itself hides @supabase/supabase-js — so components and
// tests never touch the SDK directly and a fake AuthClient can be injected.
//
// Responsibilities (Req 2.2, 3.3, 4.1, 4.4-4.7, 6.2, 6.7):
//   - restore a persisted session on load and track refresh/expiry/sign-out
//     transitions via authClient.onChange,
//   - expose signUp / signIn / signOut,
//   - clear the session on a 401 (AuthExpiredError) so the app falls back to the
//     Anonymous experience,
//   - hold a pending-gated-action ref so a sign-in triggered by Flag/Save can
//     return the reader to the report and re-enable the activated control.

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { AuthExpiredError } from '../api/client';
import { makeAuthClient, type AuthClient, type Session } from './authClient';

// The control a gated action was attempted from, retained across a sign-in so the
// post-sign-in return can re-enable exactly that control (Req 6.2, 6.7).
export type GatedControl = 'flag' | 'save';

export interface PendingGatedAction {
  reportId: string;
  control: GatedControl;
}

export interface UseSession {
  /** The live authenticated session, or null when the Reader is Anonymous. */
  session: Session | null;
  /** Whether the AuthClient is configured (Supabase reachable) — Req 5. */
  configured: boolean;
  /** True until the initial session-restore attempt resolves (Req 4.1). */
  loading: boolean;
  signUp(email: string, password: string): Promise<Session>;
  signIn(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  /** Drop the session locally and present the Anonymous experience. */
  clearSession(): void;
  /** Clear the session iff the error is a 401 expiry (Req 4.4); ignore otherwise. */
  handleAuthError(error: unknown): void;
  /**
   * A gated action awaiting a sign-in. Set it before redirecting to sign-in, then
   * read and clear it once the session becomes active to return the Reader to the
   * report and re-enable the control (Req 6.2, 6.7). A ref (not state) because the
   * post-sign-in return is driven by the session transition, not by this value.
   */
  pendingAction: MutableRefObject<PendingGatedAction | null>;
}

// Accepts an optional AuthClient so tests can inject a fake; otherwise builds the
// real one once (lazy init keeps it stable across renders — makeAuthClient
// constructs the SDK, so it must not run on every render).
export function useSession(injectedClient?: AuthClient): UseSession {
  const [client] = useState<AuthClient>(() => injectedClient ?? makeAuthClient());
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const pendingAction = useRef<PendingGatedAction | null>(null);

  // Restore a persisted session on load (Req 4.1) and subscribe to refresh /
  // expiry / sign-out transitions (Req 4.4-4.7). onChange fires on SIGNED_IN /
  // TOKEN_REFRESHED / SIGNED_OUT, so it keeps `session` in sync with the SDK.
  useEffect(() => {
    let active = true;
    client
      .getSession()
      .then((s) => {
        if (active) setSession(s);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const unsubscribe = client.onChange((s) => {
      if (active) setSession(s);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  const signUp = useCallback(
    async (email: string, password: string) => {
      const s = await client.signUp(email, password);
      setSession(s);
      return s;
    },
    [client],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const s = await client.signIn(email, password);
      setSession(s);
      return s;
    },
    [client],
  );

  // Discard the session locally even if the remote sign-out rejects, then rethrow
  // so the UI can warn the remote session may still be active (Req 3.3, 3.5).
  const signOut = useCallback(async () => {
    try {
      await client.signOut();
      setSession(null);
    } catch (e) {
      setSession(null);
      throw e;
    }
  }, [client]);

  const clearSession = useCallback(() => setSession(null), []);

  // Pipe any caught error here on the authed-request path: a 401 expiry clears the
  // session so the app falls back to Anonymous (Req 4.4); anything else is left for
  // the caller to surface (e.g. "save did not complete").
  const handleAuthError = useCallback((error: unknown) => {
    if (error instanceof AuthExpiredError) setSession(null);
  }, []);

  return {
    session,
    configured: client.configured,
    loading,
    signUp,
    signIn,
    signOut,
    clearSession,
    handleAuthError,
    pendingAction,
  };
}
