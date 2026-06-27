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
