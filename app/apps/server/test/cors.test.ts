// Feature: trust-and-launch-bundle, Property 15: CORS allows a request if and
// only if its origin matches the configured origin.
//
// Validates: Requirements 5.7, 5.8
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { allowOrigin } from '../src/http/cors';

// requestOrigin is `string | undefined`; undefined models a same-origin request
// that carries no Origin header.
const requestOrigin = fc.oneof(fc.constant<string | undefined>(undefined), fc.string());
const configuredOrigin = fc.string();

test('Property 15: allowOrigin holds iff origin is absent or matches the configured origin', () => {
  fc.assert(
    fc.property(requestOrigin, configuredOrigin, (req, configured) => {
      assert.equal(allowOrigin(req, configured), req === undefined || req === configured);
    }),
    { numRuns: 200 },
  );
});

test('present-but-mismatched origin is denied', () => {
  assert.equal(allowOrigin('https://evil.example', 'https://app.example'), false);
});

test('matching origin is allowed', () => {
  assert.equal(allowOrigin('https://app.example', 'https://app.example'), true);
});

test('absent origin (same-origin request) is allowed', () => {
  assert.equal(allowOrigin(undefined, 'https://app.example'), true);
});
