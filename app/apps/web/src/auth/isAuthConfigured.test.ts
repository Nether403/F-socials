// Feature: accounts-save-history, Property 9: Auth configuration detection is total
// Validates: Requirements 5.5
//
// isAuthConfigured(env) classifies a web Supabase configuration object. The app is
// Auth_Configured if and only if BOTH the URL and anon key are present (non-empty
// strings) AND the URL parses as a syntactically valid http(s) URL. Any absent,
// empty, non-string, or malformed value yields not-configured. The predicate is
// total: over arbitrary inputs it never throws.
//
// We assert the iff against an independent oracle (the contract restated, not a copy
// of the implementation) and assert totality by construction — every invocation
// returns a boolean and is wrapped so any throw fails the run.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isAuthConfigured, type AuthEnv } from './authClient';

// --- Independent oracle ------------------------------------------------------
// Restates the spec contract (Property 9 / Req 5.5) without reusing the impl.
// "present" = a non-empty string; URL must parse with an http: or https: protocol.
function oracleConfigured(env: AuthEnv): boolean {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  const present = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  if (!present(url) || !present(key)) return false;
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    return false;
  }
  return scheme === 'http:' || scheme === 'https:';
}

// --- Generators for URL and key fields --------------------------------------
// Cover the whole input space: present/valid, present/malformed (non-http(s) or
// garbage), empty, and absent. We model "absent" as a field that may be undefined.

// Valid http(s) URLs the oracle and impl must both accept.
const validHttpUrl = fc.webUrl({ validSchemes: ['http', 'https'] });

// Non-http(s) but URL-parseable (ftp:, mailto:, ws:, etc.) — present-but-malformed
// for our purposes since only http(s) counts as configured.
const nonHttpScheme = fc
  .tuple(
    fc.constantFrom('ftp', 'mailto', 'ws', 'file', 'data', 'tel'),
    fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !/[\s/]/.test(s)),
  )
  .map(([scheme, rest]) => `${scheme}:${rest}`);

// Arbitrary garbage strings — most will not parse as a URL at all.
const garbage = fc.string({ maxLength: 30 });

// A URL-shaped field: undefined (absent), '' (empty), valid, or malformed.
const urlField = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  validHttpUrl,
  nonHttpScheme,
  garbage,
);

// A key-shaped field: undefined (absent), '' (empty), or any non-empty string.
const keyField = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 64 }),
);

const envArb: fc.Arbitrary<AuthEnv> = fc.record(
  {
    VITE_SUPABASE_URL: urlField,
    VITE_SUPABASE_ANON_KEY: keyField,
  },
  // requiredKeys: [] lets fast-check sometimes omit a key entirely (true absence,
  // not just an undefined value) so the "absent" branch is exercised both ways.
  { requiredKeys: [] },
);

describe('isAuthConfigured (Property 9: total auth configuration detection)', () => {
  it('matches the oracle iff and never throws over arbitrary configs', () => {
    fc.assert(
      fc.property(envArb, (env) => {
        let actual: boolean;
        // Totality: the call must complete and return a boolean for any input.
        expect(() => {
          actual = isAuthConfigured(env);
        }).not.toThrow();
        expect(typeof actual!).toBe('boolean');
        // iff: configured exactly when the oracle says so.
        expect(actual!).toBe(oracleConfigured(env));
      }),
      { numRuns: 100 },
    );
  });
});
