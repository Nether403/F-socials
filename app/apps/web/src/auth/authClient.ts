// AuthClient seam for the web accounts experience (Slice 2).
//
// The rest of the app talks to the small AuthClient interface below, never to
// @supabase/supabase-js directly. This mirrors the server's ports.ts DI pattern:
//   - When Supabase is configured, makeAuthClient() returns a SupabaseAuthClient
//     that wraps the official SDK (which gives us session persistence, token
//     auto-refresh, and expiry handling for free — Req 4.1, 4.5, 4.6).
//   - When it is not configured, makeAuthClient() returns an UnavailableAuthClient
//     that never constructs the SDK, so initialization cannot throw (Req 5.4) and
//     the degraded path is a pure no-op (Req 5.1, 5.5).
//
// isAuthConfigured and validateCredentials are exported as standalone pure
// functions so the property tests (tasks 7.2/7.3) can import them in isolation.

import {
  createClient,
  type Session as SupabaseSession,
  type SupabaseClient,
} from '@supabase/supabase-js';

// --- Public types -----------------------------------------------------------

export interface Session {
  accessToken: string;
  reader: { id: string; email?: string };
}

export interface AuthClient {
  readonly configured: boolean;
  /** Restore a persisted session on load; null when none. (Req 4.1) */
  getSession(): Promise<Session | null>;
  /** Create an account and return the established session. (Req 1) */
  signUp(email: string, password: string): Promise<Session>;
  /** Sign in and return the established session. (Req 2) */
  signIn(email: string, password: string): Promise<Session>;
  /** End the session locally and remotely. (Req 3) */
  signOut(): Promise<void>;
  /** Subscribe to refresh/expiry/sign-out transitions; returns unsubscribe. (Req 4.4-4.7) */
  onChange(cb: (s: Session | null) => void): () => void;
}

/** The slice of the web env this seam reads. Injectable for testing. */
export interface AuthEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

// --- Pure predicate: configuration detection (Req 5.5, Property 9) ----------

// Auth_Configured iff both the URL and anon key are present (non-empty) and the
// URL is a syntactically valid http(s) URL. Total over any input object: any
// absent or malformed value yields false (and thus the degraded behavior).
export function isAuthConfigured(env: AuthEnv): boolean {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (typeof url !== 'string' || url.length === 0) return false;
  if (typeof key !== 'string' || key.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

// --- Pure validator: client-side credential validation (Property 8) ---------

export interface CredentialValidation {
  valid: boolean;
  /** Human-readable reason when invalid; undefined when valid. */
  message?: string;
}

const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;

// Syntactic email shape: a non-empty local-part, "@", and a domain that has a
// dot-separated top-level domain. No spaces or extra "@" anywhere. This is a
// deliberately simple structural check, not full RFC 5322 (Req 1.6, 2.6).
// The TLD class excludes "." so the segment after the last dot is a real,
// non-empty label — rejecting an empty TLD such as a trailing dot ("a@b.").
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@.]+$/;

// Accepts the submission if and only if (Req 1.5, 1.6, 1.7, 2.6):
//   - email is non-empty, at most 254 chars, and syntactically valid, and
//   - password is between 8 and 72 characters inclusive.
// Returns a validation message for every rejection so the caller can display it
// and send no request.
export function validateCredentials(email: string, password: string): CredentialValidation {
  if (email.length === 0) {
    return { valid: false, message: 'Email is required.' };
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    return { valid: false, message: `Email must be at most ${MAX_EMAIL_LENGTH} characters.` };
  }
  if (!EMAIL_RE.test(email)) {
    return { valid: false, message: 'Enter a valid email address.' };
  }
  if (password.length === 0) {
    return { valid: false, message: 'Password is required.' };
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return {
      valid: false,
      message: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }
  return { valid: true };
}

// --- Timeouts ----------------------------------------------------------------

const AUTH_TIMEOUT_MS = 30_000;

export class AuthTimeoutError extends Error {
  constructor(message = 'auth_timeout') {
    super(message);
    this.name = 'AuthTimeoutError';
  }
}

export class AuthUnavailableError extends Error {
  constructor(message = 'auth_unavailable') {
    super(message);
    this.name = 'AuthUnavailableError';
  }
}

// Race a promise against a 30s deadline (Req 1.8, 2.7). The AbortController lets
// the caller signal cancellation; we also reject with AuthTimeoutError so the UI
// can surface a timeout and re-enable its control. The SDK call itself cannot be
// hard-aborted, so the race is what bounds the user-visible wait.
function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms = AUTH_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AuthTimeoutError());
    }, ms);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

// --- Session mapping ---------------------------------------------------------

function toSession(s: SupabaseSession | null): Session | null {
  if (!s || !s.access_token) return null;
  return {
    accessToken: s.access_token,
    reader: { id: s.user.id, email: s.user.email ?? undefined },
  };
}

// --- Supabase-backed implementation -----------------------------------------

class SupabaseAuthClient implements AuthClient {
  readonly configured = true;
  private readonly client: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }

  async getSession(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession();
    return toSession(data.session);
  }

  async signUp(email: string, password: string): Promise<Session> {
    return withTimeout(async () => {
      const { data, error } = await this.client.auth.signUp({ email, password });
      if (error) throw error;
      const session = toSession(data.session);
      if (!session) throw new Error('sign-up returned no session');
      return session;
    });
  }

  async signIn(email: string, password: string): Promise<Session> {
    return withTimeout(async () => {
      const { data, error } = await this.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const session = toSession(data.session);
      if (!session) throw new Error('sign-in returned no session');
      return session;
    });
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  onChange(cb: (s: Session | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      cb(toSession(session));
    });
    return () => data.subscription.unsubscribe();
  }
}

// --- Degraded implementation -------------------------------------------------

// Used when the app is not Auth_Configured. It never constructs the SDK, so boot
// cannot throw (Req 5.4). Session restore resolves to null (the reader is simply
// anonymous); the auth action calls reject with auth_unavailable so the UI shows
// the account-features-unavailable message (Req 5.1, 5.3).
class UnavailableAuthClient implements AuthClient {
  readonly configured = false;

  async getSession(): Promise<Session | null> {
    return null;
  }

  async signUp(): Promise<Session> {
    throw new AuthUnavailableError();
  }

  async signIn(): Promise<Session> {
    throw new AuthUnavailableError();
  }

  async signOut(): Promise<void> {
    // No remote session to end; resolve quietly.
  }

  onChange(): () => void {
    return () => {};
  }
}

// --- Factory -----------------------------------------------------------------

// Returns the Supabase-backed client when configured, else the degraded client.
// Reads import.meta.env by default; accepts an explicit env for testing.
export function makeAuthClient(env: AuthEnv = import.meta.env as AuthEnv): AuthClient {
  if (!isAuthConfigured(env)) return new UnavailableAuthClient();
  return new SupabaseAuthClient(env.VITE_SUPABASE_URL!, env.VITE_SUPABASE_ANON_KEY!);
}
