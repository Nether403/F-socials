// Feature: observability-instrumentation, Property 2: Redaction idempotence —
// applying the Redactor to an already-redacted payload returns a payload deeply
// equal to that already-redacted payload.
// Validates: Requirements 5.3

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { redact } from '../src/infra/telemetry/redact';

// Keys span the three relevant classes so redaction actually does work on most
// inputs: denied keys (dropped at every depth), benign keys (preserved), and free
// arbitrary strings (some may incidentally match the case-insensitive deny-list).
const deniedKey = fc.constantFrom(
  'transcript',
  'claimText',
  'rawClaim',
  'jwt',
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'secret',
  'password',
  'userId',
  'user_id',
  'email',
);
const benignKey = fc.constantFrom(
  'reportId',
  'contentId',
  'hash',
  'stage',
  'providerCategory',
  'count',
  'durationMs',
  'outcome',
  'sourceTier',
);
const key = fc.oneof(deniedKey, benignKey, fc.string());

// Leaf primitives, incl. null/undefined and a few literals that double as denied
// values when fed to the value-based scrub below.
const leaf = fc.oneof(
  fc.string(),
  fc.constantFrom('leaked-jwt', 'Bearer abc.def', 'transcript-body'),
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
);

// Arbitrary nested objects/arrays/primitives.
const payload = fc.letrec<{ tree: unknown }>((rec) => ({
  tree: fc.oneof(
    { maxDepth: 4, withCrossShrink: true },
    leaf,
    fc.array(rec('tree'), { maxLength: 4 }),
    fc.dictionary(key, rec('tree'), { maxKeys: 5 }),
  ),
})).tree;

// A small denied-value set drawn from the literals leaves can produce, so the
// value-based scrub path is exercised too.
const deniedValues = fc.uniqueArray(
  fc.constantFrom('leaked-jwt', 'Bearer abc.def', 'transcript-body'),
  { maxLength: 3 },
).map((vs) => new Set(vs));

test('Property 2: redact(redact(p)) is deeply equal to redact(p)', () => {
  fc.assert(
    fc.property(payload, deniedValues, fc.boolean(), (p, denied, addCycle) => {
      // Cyclic inputs need care: redact resolves a back-edge to a marker, so the
      // once-redacted output is acyclic and safe to deep-compare. Inject a cycle on
      // object/array inputs to cover Req 5.6's cyclic case under idempotence.
      if (addCycle && p !== null && typeof p === 'object') {
        (p as Record<string, unknown>).self = p;
      }
      const once = redact(p, denied);
      assert.deepEqual(redact(once, denied), once);
    }),
    { numRuns: 200 },
  );
});
