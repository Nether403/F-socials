// Feature: observability-instrumentation, Property 1: Redaction never emits a Denied_Field.
// Validates: Requirements 5.2, 4.4, 9.5.
//
// For ANY candidate payload — arbitrarily nested objects/arrays seeded with denied
// keys (case-insensitive substrings of DENIED_KEYS, at any depth, in any casing/
// affixing) and denied literal values at any depth — the payload returned by
// `redact(payload, deniedValues)` contains, at every depth: no key matching a
// Denied_Field token, and no string value equal to a supplied denied value.

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { redact, containsDeniedField } from '../src/infra/telemetry/redact';

// Mirror of the Redactor's deny-list (case-insensitive substring match).
const DENIED_KEYS = [
  'transcript', 'claimtext', 'rawclaim', 'jwt', 'token', 'apikey', 'api_key',
  'authorization', 'secret', 'password', 'userid', 'user_id', 'email',
];
const isDeniedKey = (k: string) => {
  const lower = k.toLowerCase();
  return DENIED_KEYS.some((d) => lower.includes(d));
};

// A key guaranteed to match a Denied_Field token: a token wrapped in arbitrary
// affixes and re-cased, so the test exercises substring + case-insensitive matching.
const deniedKeyArb = fc
  .tuple(fc.constantFrom(...DENIED_KEYS), fc.string(), fc.string(), fc.boolean())
  .map(([tok, pre, suf, up]) => {
    const k = `${pre}${tok}${suf}`;
    return up ? k.toUpperCase() : k;
  });

// A key guaranteed NOT to match any token.
const normalKeyArb = fc.string({ minLength: 1 }).filter((k) => !isDeniedKey(k));

const keyArb = fc.oneof(deniedKeyArb, normalKeyArb);

// Distinctive denied values so randomly-generated normal strings never collide.
const deniedValueArb = fc.string().map((s) => `DENIED::${s}`);
const normalPrimitive = fc.oneof(
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.string().filter((s) => !s.startsWith('DENIED::')),
);

// Build { deniedValues, payload }: a nested tree whose leaves may be normal
// primitives OR one of the supplied denied values, and whose object keys may be
// denied or normal — denied material injected at arbitrary depth.
const caseArb = fc
  .array(deniedValueArb, { maxLength: 5 })
  .chain((pool) => {
    const leaf = pool.length
      ? fc.oneof(normalPrimitive, fc.constantFrom(...pool))
      : normalPrimitive;
    const { node } = fc.letrec<{ node: unknown }>((tie) => ({
      node: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        leaf,
        fc.array(tie('node'), { maxLength: 4 }),
        fc.dictionary(keyArb, tie('node'), { maxKeys: 4 }),
      ),
    }));
    return fc.record({ deniedValues: fc.constant(pool), payload: node });
  });

// Recursively assert: no denied key, and no string value in the denied set, at depth.
function assertNoDenied(value: unknown, denied: ReadonlySet<string>): void {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string') {
      assert.ok(!denied.has(value), `denied value survived: ${value}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const el of value) assertNoDenied(el, denied);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    assert.ok(!isDeniedKey(k), `denied key survived: ${k}`);
    assertNoDenied(v, denied);
  }
}

test('Property 1: redaction never emits a Denied_Field key or value at any depth', () => {
  fc.assert(
    fc.property(caseArb, ({ deniedValues, payload }) => {
      const denied = new Set(deniedValues);
      const out = redact(payload, denied);
      // Structural: no Denied_Field key survives anywhere (the Redactor's own check).
      assert.equal(containsDeniedField(out), false);
      // Both structural keys and value-based literals, verified by an independent walk.
      assertNoDenied(out, denied);
    }),
    { numRuns: 200 },
  );
});
