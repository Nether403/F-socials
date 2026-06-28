// Feature: observability-instrumentation, Property 11: Unknown-context substitution
// is total and safe.
// Validates: Requirements 4.7, 4.3.
//
// For any partial error-context object — fields missing, empty, whitespace-only,
// non-string, an arbitrary providerCategory value, or a sensitive (Denied_Field)
// string — buildErrorContext SHALL:
//   (a) always output an object carrying all three keys reportId/stage/providerCategory
//       (Req 4.3), each a non-empty string;
//   (b) substitute the literal string 'unknown' (never omit) for any field that cannot
//       be determined (Req 4.7) — a non-string or blank reportId/stage, and a
//       providerCategory outside the five known categories; and
//   (c) the substituted value SHALL never equal a Denied_Field value (Req 4.7) — the
//       only substituted value is the literal 'unknown', which must never collide with
//       a sensitive value handed in for a field.

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildErrorContext } from '../src/pipeline/worker';

// The five providerCategory values that pass through unchanged; anything else collapses
// to 'unknown' (mirrors PROVIDER_CATEGORIES in worker.ts).
const VALID_PC = new Set(['llm', 'evidence', 'perspective', 'transcript', 'unknown']);

// Representative Denied_Field VALUES (transcript text, raw claim, JWT, token, secret,
// user id, email, password). The substituted literal 'unknown' must never equal any of
// these. None of them is the string 'unknown'.
const DENIED_VALUES = [
  'full transcript text goes here',
  'the raw claim text',
  'eyJhbGciOiJIUzI1NiJ9.payload.signature', // jwt-like
  'Bearer abc123token',
  'sk-secretapikeyvalue',
  'user-12345',
  'person@example.com',
  'hunter2password',
] as const;

const deniedSet = new Set<string>(DENIED_VALUES);

// Oracle for the determinable-string fields (reportId, stage): a non-empty trimmed
// string passes through verbatim, everything else is undeterminable.
const determinable = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;

// Field arbitrary spanning every undeterminable shape plus determinable strings and
// sensitive (denied) string values.
const fieldArb = fc.oneof(
  fc.constant(undefined), // missing
  fc.constant(''), // empty
  fc.constantFrom('   ', '\t', '\n', '  \t \n '), // whitespace-only -> undeterminable
  fc.integer(), // non-string
  fc.boolean(), // non-string
  fc.constant(null), // non-string
  fc.object(), // non-string
  fc.array(fc.anything()), // non-string
  fc.constantFrom(...DENIED_VALUES), // sensitive string (non-empty -> passes through)
  fc.string({ minLength: 1 }).map((s) => `id-${s}`), // determinable non-empty string
);

// providerCategory arbitrary: the five valid categories plus invalid shapes (arbitrary
// strings, denied values, non-strings) that must collapse to 'unknown'.
const pcArb = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom('llm', 'evidence', 'perspective', 'transcript', 'unknown'),
  fc.constantFrom(...DENIED_VALUES),
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.object(),
);

const partialArb = fc.record({
  reportId: fieldArb,
  stage: fieldArb,
  providerCategory: pcArb,
});

test('Property 11: unknown-context substitution is total and safe', () => {
  // Sanity: the substituted literal must not itself be a Denied_Field value.
  assert.ok(!deniedSet.has('unknown'));

  fc.assert(
    fc.property(partialArb, (partial) => {
      const ctx = buildErrorContext(partial as Record<string, unknown>);

      // (a) All three keys present, each a non-empty string (Req 4.3) — never omitted.
      for (const key of ['reportId', 'stage', 'providerCategory'] as const) {
        assert.ok(Object.prototype.hasOwnProperty.call(ctx, key), `${key} must be present`);
        assert.equal(typeof ctx[key], 'string');
        assert.notEqual(ctx[key], '');
      }

      // Expected values from the oracle.
      const expectedReportId = determinable(partial.reportId) ?? 'unknown';
      const expectedStage = determinable(partial.stage) ?? 'unknown';
      const pc = partial.providerCategory;
      const expectedPc = typeof pc === 'string' && VALID_PC.has(pc) ? pc : 'unknown';

      assert.equal(ctx.reportId, expectedReportId);
      assert.equal(ctx.stage, expectedStage);
      assert.equal(ctx.providerCategory, expectedPc);

      // (b) + (c): any field that was undeterminable is the literal 'unknown' (not
      // omitted), and that substituted value is never a Denied_Field value (Req 4.7).
      const checks: Array<[string, boolean]> = [
        [ctx.reportId, determinable(partial.reportId) === undefined],
        [ctx.stage, determinable(partial.stage) === undefined],
        [ctx.providerCategory, expectedPc === 'unknown'],
      ];
      for (const [value, wasSubstituted] of checks) {
        if (wasSubstituted) {
          assert.equal(value, 'unknown');
          assert.ok(!deniedSet.has(value), 'substituted value must never be a Denied_Field value');
        }
      }
    }),
    { numRuns: 200 },
  );
});
