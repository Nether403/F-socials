// Feature: observability-instrumentation, Property 3: Redactor preserves non-denied
// fields and never mutates input.
// Validates: Requirements 5.5, 5.1.
//
// For any payload built from ONLY non-denied keys (and with no supplied denied
// literal values), the Redactor preserves every field key-and-value unchanged — so
// the returned payload is deeply equal to the input — and the caller's input object
// is deeply equal before and after the call (no mutation, Req 5.1). The non-denied
// space deliberately spans the field shapes the spec calls out: report ids, content
// ids, hashes, stage names, provider categories, counts, durations, and
// Evidence_Outcome labels.

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { redact } from '../src/infra/telemetry/redact';

// The Redactor's case-insensitive SUBSTRING deny-list (mirrors redact.ts). A key is
// "non-denied" iff its lower-cased form contains none of these tokens.
const DENIED_KEYS = [
  'transcript',
  'claimtext',
  'rawclaim',
  'jwt',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'secret',
  'password',
  'userid',
  'user_id',
  'email',
];

const isDeniedKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  return DENIED_KEYS.some((d) => lower.includes(d));
};

// Realistic non-denied field names the spec enumerates, plus arbitrary safe keys
// (filtered so a randomly-generated key can never collide with a denied substring).
const realisticKey = fc.constantFrom(
  'reportId',
  'contentId',
  'hash',
  'stage',
  'providerCategory',
  'count',
  'durationMs',
  'evidenceOutcome',
  'sourceTier',
  'status',
  'route',
  'claimId',
  'submissionId',
);

const arbitraryKey = fc
  .string({ minLength: 1, maxLength: 12 })
  // Exclude `__proto__`: it makes a generator build a null-prototype object, which
  // is not realistic telemetry data and is an artifact of the prototype, not the
  // field key/value preservation this property is about.
  .filter((k) => !isDeniedKey(k) && k !== '__proto__');

const safeKey = fc.oneof(realisticKey, arbitraryKey);

// structuredClone-safe leaf values (no functions/symbols), incl. the categorical
// labels and counts/durations the spec mentions.
const leaf = fc.oneof(
  fc.constantFrom(
    'matched_fact_check',
    'matched_primary_source',
    'matched_institutional_source',
    'relevant_context_only',
    'no_sufficient_evidence',
    'not_fact_checkable',
    'llm',
    'evidence',
    'perspective',
    'transcript_stage',
    'ready',
    'needs_review',
  ),
  fc.integer({ min: 0, max: 1_000_000 }), // counts / durationMs
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
  fc.string(),
);

// Arbitrarily nested objects/arrays keyed ONLY by non-denied keys.
const nonDeniedPayload = fc.letrec((tie) => ({
  node: fc.oneof(
    { weight: 3, arbitrary: leaf },
    { weight: 1, arbitrary: fc.array(tie('node'), { maxLength: 4 }) },
    {
      weight: 1,
      arbitrary: fc.dictionary(safeKey, tie('node'), { maxKeys: 5, noNullPrototype: true }),
    },
  ),
})).node;

test('Property 3: redact preserves non-denied fields and never mutates input', () => {
  fc.assert(
    fc.property(nonDeniedPayload, (payload) => {
      // Snapshot the caller's input before the call.
      const before = structuredClone(payload);

      const out = redact(payload);

      // Every non-denied field survives key-and-value unchanged (Req 5.5):
      // the sanitized payload is deeply equal to the input.
      assert.deepStrictEqual(out, payload);

      // The caller's input object is deeply equal before and after (Req 5.1).
      assert.deepStrictEqual(payload, before);
    }),
    { numRuns: 200 },
  );
});
