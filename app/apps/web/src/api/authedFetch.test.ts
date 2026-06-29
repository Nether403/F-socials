// Feature: accounts-save-history, Property 10: Token attachment follows session state
// Validates: Requirements 3.4, 4.2, 4.3
//
// authedFetch(path, init, accessToken?) is the session-aware wrapper for every
// identity/mutating API route. The universal guarantee:
//   an `Authorization: Bearer <accessToken>` header is attached to the outgoing
//   request IF AND ONLY IF a session token is supplied; with no active session
//   (no token) the request carries no `Authorization` header at all.
//
// We stub the global `fetch`, drive authedFetch with arbitrary routes, methods,
// caller-supplied headers, and an optional token, then inspect the actual Headers
// object handed to fetch. The iff is asserted against an independent oracle (the
// contract restated: attach exactly when a non-empty token string is present) so
// the test does not merely echo the implementation. Caller headers never carry an
// Authorization of their own, so any header observed comes from authedFetch.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { authedFetch } from './client';

// Capture the Headers passed to fetch on each call. The stub returns a 200 so
// authedFetch resolves normally (a 401 would throw AuthExpiredError, which is a
// different contract and out of scope here).
let lastHeaders: Headers | undefined;
function stubFetch() {
  lastHeaders = undefined;
  const spy = vi.fn(async (_url: string, init?: RequestInit) => {
    lastHeaders = new Headers(init?.headers);
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Generators --------------------------------------------------------------
// Representative identity/mutating routes plus arbitrary same-shaped paths.
const pathArb = fc.oneof(
  fc.constantFrom(
    '/api/v1/analyses/abc/save',
    '/api/v1/analyses/abc/flags',
    '/api/v1/saved-reports',
  ),
  fc.string({ minLength: 1, maxLength: 24 }).map((s) => `/api/v1/${s.replace(/\s/g, '')}`),
);

const methodArb = fc.constantFrom('GET', 'POST', 'DELETE', 'PUT', 'PATCH');

// Caller-supplied headers that deliberately never include Authorization, so the
// only Authorization that can appear is the one authedFetch adds.
const callerHeadersArb = fc.dictionary(
  fc.constantFrom('content-type', 'accept', 'x-trace-id', 'x-custom'),
  fc.string({ maxLength: 20 }),
  { maxKeys: 3 },
);

// The session token field: absent (no session), empty string (falsy — not a real
// token), or a non-empty token string. The contract attaches the header exactly
// when a non-empty token is supplied. Real Access_Tokens are JWTs carrying no
// whitespace; we exclude whitespace here because the Headers API legitimately
// trims leading/trailing whitespace from header values (a normalization concern,
// not part of this session-state property).
const tokenArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 64 }).filter((s) => !/\s/.test(s)),
);

// Independent oracle for Property 10: a Bearer header is attached iff a non-empty
// token string was supplied.
const shouldAttach = (token: string | undefined): token is string =>
  typeof token === 'string' && token.length > 0;

describe('authedFetch (Property 10: token attachment follows session state)', () => {
  it('attaches Authorization: Bearer iff a session token is supplied', async () => {
    await fc.assert(
      fc.asyncProperty(
        pathArb,
        methodArb,
        callerHeadersArb,
        tokenArb,
        async (path, method, headers, token) => {
          stubFetch();
          await authedFetch(path, { method, headers }, token);

          const auth = lastHeaders!.get('Authorization');
          if (shouldAttach(token)) {
            // iff (forward): an active session attaches exactly one Bearer header
            // carrying the access token (Req 4.2).
            expect(auth).toBe(`Bearer ${token}`);
          } else {
            // iff (reverse): no session ⇒ no Authorization header at all (Req 3.4, 4.3).
            expect(auth).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
