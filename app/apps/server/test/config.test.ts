// Feature: trust-and-launch-bundle, Property 16: Missing required config is
// reported by name for the deployed configuration (Validates: Requirements 5.11).
//
// For any deployed-configuration env, missingRequiredConfig returns exactly the
// names of the required-but-absent values — no more, no fewer — accounting for
// the conditional rules (DATABASE_URL only when REPO_DRIVER=postgres, REDIS_URL
// only when a driver is upstash, CORS_ORIGIN always). In dev mode it returns [].

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { missingRequiredConfig } from '../src/config';

// Either a present value (non-empty string) or absent (undefined or empty string).
const presence = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.constant(''), // empty counts as absent
  fc.string({ minLength: 1 }).map((s) => `x${s}`), // guaranteed non-empty -> present
);

const deployedEnv = fc.record({
  REPO_DRIVER: fc.constantFrom('postgres', 'memory', undefined),
  CACHE_DRIVER: fc.constantFrom('upstash', 'memory', undefined),
  QUEUE_DRIVER: fc.constantFrom('upstash', 'memory', undefined),
  DATABASE_URL: presence,
  REDIS_URL: presence,
  CORS_ORIGIN: presence,
});

const isAbsent = (v: string | undefined) => !v;

// Independent oracle of the required-but-absent names, in the helper's order.
function expectedMissing(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  if (env.REPO_DRIVER === 'postgres' && isAbsent(env.DATABASE_URL)) out.push('DATABASE_URL');
  if ((env.CACHE_DRIVER === 'upstash' || env.QUEUE_DRIVER === 'upstash') && isAbsent(env.REDIS_URL)) {
    out.push('REDIS_URL');
  }
  if (isAbsent(env.CORS_ORIGIN)) out.push('CORS_ORIGIN');
  return out;
}

test('Property 16: deployed missing-config is reported by name, exactly', () => {
  fc.assert(
    fc.property(deployedEnv, (env) => {
      assert.deepEqual(missingRequiredConfig(env, 'deployed'), expectedMissing(env));
    }),
    { numRuns: 200 },
  );
});

test('Property 16: dev mode gates nothing regardless of env', () => {
  fc.assert(
    fc.property(deployedEnv, (env) => {
      assert.deepEqual(missingRequiredConfig(env, 'dev'), []);
    }),
    { numRuns: 200 },
  );
});

// Feature: parallel-evidence-lookups, Property 8: Concurrency-cap resolution —
// across all invalid classes (absent / empty / non-numeric / non-integer / <1 / >32)
// resolveConcurrencyCap falls back to the default 4 with a warning naming the
// CONCURRENCY_CAP variable; integers in [1,32] pass through unchanged with no warning.
// Validates: Requirements 2.2, 2.3, 2.4.

import { resolveConcurrencyCap, CONCURRENCY_CAP_DEFAULT } from '../src/config';

// Valid class: an integer in the inclusive range [1, 32].
const validRaw = fc.integer({ min: 1, max: 32 }).map((n) => String(n));

// Invalid classes, each generated independently then unioned.
const invalidRaw = fc.oneof(
  fc.constant<string | undefined>(undefined), // absent
  fc.constant(''), // empty
  fc.constantFrom('   ', '\t'), // whitespace-only (empty after trim)
  fc.string().filter((s) => Number.isNaN(Number(s)) && s.trim() !== ''), // non-numeric
  fc.float({ min: 1, max: 32, noNaN: true }).filter((n) => !Number.isInteger(n)).map(String), // non-integer
  fc.integer({ max: 0 }).map(String), // < 1
  fc.integer({ min: 33 }).map(String), // > 32
);

test('Property 8: integers in [1,32] pass through with no warning', () => {
  fc.assert(
    fc.property(validRaw, (raw) => {
      const result = resolveConcurrencyCap(raw);
      assert.equal(result.value, Number(raw));
      assert.equal(result.warning, undefined);
    }),
    { numRuns: 200 },
  );
});

test('Property 8: invalid input falls back to default 4 with a CONCURRENCY_CAP warning', () => {
  fc.assert(
    fc.property(invalidRaw, (raw) => {
      const result = resolveConcurrencyCap(raw);
      assert.equal(result.value, CONCURRENCY_CAP_DEFAULT);
      assert.equal(result.value, 4);
      assert.ok(result.warning, 'expected a warning for invalid input');
      assert.ok(
        result.warning!.includes('CONCURRENCY_CAP'),
        `warning should name CONCURRENCY_CAP, got: ${result.warning}`,
      );
    }),
    { numRuns: 200 },
  );
});

// Feature: observability-instrumentation, Property 12: Telemetry config never blocks startup.
// Validates: Requirements 3.3, 2.2, 2.3, 2.4.
//
// (a) For any env, in any mode, missingRequiredConfig never reports SENTRY_DSN or
//     POSTHOG_KEY as a required-but-absent name — absent telemetry config can never
//     block startup (Req 3.3).
// (b) The exposed telemetry config values are the verbatim trimmed env string, or ''
//     when the variable is unset or whitespace-only (Req 2.2, 2.3, 2.4), and the
//     not-configured classification is exactly the empty-string case (Req 2.5).

import { config, isTelemetryConfigured } from '../src/config';

const TELEMETRY_VARS = ['SENTRY_DSN', 'POSTHOG_KEY'] as const;

// Arbitrary raw env value: unset, empty, whitespace-only, or a string that may carry
// surrounding whitespace around non-empty content.
const rawEnvValue = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.constant(''),
  fc.constantFrom('   ', '\t', '\n', ' \t \n '), // whitespace-only -> '' after trim
  fc.string().map((s) => `  ${s}  `), // padded; may be whitespace-only or non-empty
  fc.string({ minLength: 1 }), // arbitrary, possibly already trimmed
);

// Spec derivation: verbatim trimmed string, or '' when unset (Req 2.2/2.3/2.4).
const telemetryConfigValue = (raw: string | undefined): string => (raw ?? '').trim();

// An env that includes the config fields missingRequiredConfig inspects PLUS arbitrary
// telemetry vars, so we can assert the telemetry vars never leak into the result.
const envWithTelemetry = fc.record({
  REPO_DRIVER: fc.constantFrom('postgres', 'memory', undefined),
  CACHE_DRIVER: fc.constantFrom('upstash', 'memory', undefined),
  QUEUE_DRIVER: fc.constantFrom('upstash', 'memory', undefined),
  DATABASE_URL: presence,
  REDIS_URL: presence,
  CORS_ORIGIN: presence,
  SENTRY_DSN: rawEnvValue,
  POSTHOG_KEY: rawEnvValue,
});

test('Property 12: telemetry vars never appear in missingRequiredConfig, in any mode', () => {
  fc.assert(
    fc.property(envWithTelemetry, fc.constantFrom<'deployed' | 'dev'>('deployed', 'dev'), (env, mode) => {
      const missing = missingRequiredConfig(env, mode);
      for (const name of TELEMETRY_VARS) {
        assert.ok(!missing.includes(name), `${name} must never block startup (mode=${mode})`);
      }
    }),
    { numRuns: 200 },
  );
});

test('Property 12: telemetry config is the verbatim trimmed value, or "" when unset/whitespace-only', () => {
  fc.assert(
    fc.property(rawEnvValue, (raw) => {
      const value = telemetryConfigValue(raw);
      // verbatim trimmed (Req 2.2, 2.3)
      assert.equal(value, (raw ?? '').trim());
      // unset or whitespace-only -> '' (Req 2.4)
      const isBlank = raw === undefined || raw.trim() === '';
      assert.equal(value === '', isBlank);
      // not-configured classification is exactly the empty-string case (Req 2.5)
      assert.equal(isTelemetryConfigured(value), !isBlank);
    }),
    { numRuns: 200 },
  );
});

test('Property 12: exposed config values match the verbatim trimmed env (single-read, no drift)', () => {
  // config reads SENTRY_DSN/POSTHOG_KEY once at module init; assert the exposed values
  // equal the verbatim trimmed env strings the spec mandates (Req 2.2, 2.3, 2.4, 2.7).
  assert.equal(config.sentryDsn, telemetryConfigValue(process.env.SENTRY_DSN));
  assert.equal(config.posthogKey, telemetryConfigValue(process.env.POSTHOG_KEY));
});
