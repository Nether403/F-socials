// Feature: observability-instrumentation, Property 4: Redactor totality —
// for any input whatsoever (null, undefined, primitives, arrays, deeply nested
// objects, and objects containing cyclic references) the Redactor returns a
// sanitized payload without throwing.
// Validates: Requirements 5.6

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { redact } from '../src/infra/telemetry/redact';

// Keys span denied/benign/arbitrary so redaction does real work on most inputs.
const key = fc.oneof(
  fc.constantFrom(
    'transcript',
    'claimText',
    'jwt',
    'token',
    'apiKey',
    'authorization',
    'secret',
    'password',
    'userId',
    'email',
  ),
  fc.constantFrom('reportId', 'stage', 'count', 'durationMs', 'outcome', 'sourceTier'),
  fc.string(),
);

// Leaf primitives, incl. null/undefined and a few odd values.
const leaf = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double(), // includes NaN/Infinity
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
);

// Arbitrarily nested objects/arrays/primitives, deep enough to exercise recursion.
const tree = fc.letrec<{ node: unknown }>((rec) => ({
  node: fc.oneof(
    { maxDepth: 5, withCrossShrink: true },
    leaf,
    fc.array(rec('node'), { maxLength: 5 }),
    fc.dictionary(key, rec('node'), { maxKeys: 6 }),
  ),
})).node;

const deniedValues = fc
  .uniqueArray(fc.string(), { maxLength: 4 })
  .map((vs) => new Set(vs));

test('Property 4: redact returns without throwing over null/undefined/primitives/arrays/nested', () => {
  fc.assert(
    fc.property(tree, deniedValues, (p, denied) => {
      // Totality is the claim: the call must return (not throw), regardless of shape.
      assert.doesNotThrow(() => redact(p, denied));
    }),
    { numRuns: 200 },
  );
});

test('Property 4: redact returns without throwing on cyclic inputs', () => {
  fc.assert(
    fc.property(
      // Build a normal object, then on one branch assign a self-reference so the
      // input carries a cycle. We assert return, not shape (Req 5.6).
      fc.dictionary(key, leaf, { minKeys: 1, maxKeys: 5 }),
      fc.boolean(),
      deniedValues,
      (base, nestSelf, denied) => {
        const obj: Record<string, unknown> = { ...base };
        if (nestSelf) {
          // Cycle one level down a branch rather than at the root.
          const branch: Record<string, unknown> = { child: 1 };
          branch.self = branch;
          obj.branch = branch;
        } else {
          obj.self = obj; // direct self-reference at the root
        }
        assert.doesNotThrow(() => redact(obj, denied));
      },
    ),
    { numRuns: 200 },
  );
});

// A few explicit non-generated odd inputs, asserting return for each.
test('Property 4: redact returns for explicit edge inputs', () => {
  for (const input of [null, undefined, 0, '', false, NaN, [], {}, [undefined, null]]) {
    assert.doesNotThrow(() => redact(input));
  }
});
