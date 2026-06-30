// Feature: intervention-and-scale, Property 4: Neutrality is enforced at every outbound boundary
// Feature: intervention-and-scale, Property 5: The neutrality guard withholds any failing payload
// Feature: intervention-and-scale, Property 6: The neutrality guard is total
// Validates: Requirements 2.4, 4.1, 4.2, 4.5, 4.6, 7.7, 11.2, 11.3, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';
import type { Response } from 'express';

import { neutralityGuard } from '../src/infra/telemetry/neutrality';
import { sendNeutral } from '../src/http/respond';
import { projectFrictionOverlay } from '../src/core/frictionOverlay';
import { gateValidReportArbitrary } from './reportGraph.arb';

// --- Building blocks ---------------------------------------------------------------
// Lorem text is drawn from a fixed latin dictionary that contains none of the guard's
// person/dimension/truth-verdict tokens, so a "legitimate" payload stays legitimate.
const safeText = fc.lorem({ maxCount: 6 });
const severity = fc.constantFrom('low', 'medium', 'high');
const evidenceStrength = fc.constantFrom('none', 'weak', 'moderate', 'strong');
// Source tiers ride on sources/citations only. The VALUE 'tierN_*' carries a tier
// token but no person token, and the KEY 'sourceTier' fuses no person — both pass.
const sourceTier = fc.constantFrom(
  'tier1_primary',
  'tier2_institutional',
  'tier3_viewpoint',
  'excluded',
);
const technique = fc.constantFrom(
  'emotional_language',
  'loaded_terms',
  'false_balance',
  'appeal_to_authority',
  'selective_emphasis',
  'us_vs_them',
);

// --- LEGITIMATE lens-safe payload shapes -------------------------------------------

// Feed Friction Dial overlay shape.
const frictionOverlayArb = fc.record({
  reportId: fc.uuid(),
  framingSignals: fc.array(
    fc.record({ technique, severity, quote: safeText, explanation: safeText }),
    { maxLength: 6 },
  ),
  evidenceSummary: fc.array(
    fc.record({ claimText: safeText, evidenceStrength }),
    { maxLength: 8 },
  ),
  reportUrl: fc.webUrl(),
});

// Institutional API (GraphQL data) shapes — Citation / Claim / ClaimPage /
// PerspectiveLink — tiers attached to sources only, no person+dimension field.
const citationArb = fc.record({
  sourceUrl: fc.webUrl(),
  sourceName: safeText,
  sourceTier,
  excerpt: safeText,
  supports: fc.constantFrom('supports', 'refutes', 'mixed', 'unrelated'),
  claimUid: fc.uuid(),
});
const claimArb = fc.record({
  claimUid: fc.uuid(),
  reportId: fc.uuid(),
  claimText: safeText,
  evidenceStrength,
  citationCount: fc.nat({ max: 20 }),
  verifiability: fc.constantFrom('verifiable', 'unverifiable', 'opinion'),
  citations: fc.array(citationArb, { maxLength: 4 }),
});
const claimPageArb = fc.record({
  items: fc.array(claimArb, { maxLength: 4 }),
  totalCount: fc.nat(),
  pageOffset: fc.nat(),
  hasNextPage: fc.boolean(),
});
const perspectiveLinkArb = fc.record({
  reportId: fc.uuid(),
  issueFrameLabel: safeText,
  divergence: fc.double({ min: 0, max: 1, noNaN: true }),
  dehumanization: fc.double({ min: 0, max: 1, noNaN: true }),
  sourceName: safeText,
  sourceTier,
});

// Coaching Engine response shape — advisory, no creator rating, no verdict.
const coachingResponseArb = fc.record({
  issues: fc.array(
    fc.record({
      kind: fc.constantFrom('framing', 'unsupported_claim'),
      technique: safeText,
      quote: safeText,
      explanation: safeText,
      suggestion: safeText,
    }),
    { maxLength: 6 },
  ),
  noIssues: fc.boolean(),
});

const legitimatePayloadArb = fc.oneof(
  frictionOverlayArb,
  claimArb,
  citationArb,
  claimPageArb,
  perspectiveLinkArb,
  coachingResponseArb,
);

// --- ADVERSARIAL payloads (must FAIL the guard) ------------------------------------
const adversarialPayloadArb = fc.oneof(
  // A source tier co-located with a creator/author/channel identity.
  fc.record({ creatorId: fc.uuid(), tier: sourceTier, reportId: fc.uuid() }),
  fc.record({ authorTier: sourceTier, reportId: fc.uuid() }),
  // A content-truthfulness verdict.
  fc.record({ verdict: fc.constantFrom('false', 'true', 'misleading') }),
  fc.record({ truthVerdict: fc.constantFrom('false', 'true') }),
  fc.record({ isFake: fc.boolean(), claimText: safeText }),
  // A reliability/trust rating fused to a person/channel.
  fc.record({ creatorReliability: fc.double({ min: 0, max: 1, noNaN: true }) }),
  fc.record({ channelTrust: fc.double({ min: 0, max: 1, noNaN: true }) }),
  // Nested adversarial field (offence below the top level).
  fc.record({
    data: fc.record({
      claims: fc.array(fc.record({ creatorRating: fc.nat() }), {
        minLength: 1,
        maxLength: 3,
      }),
    }),
  }),
);

// --- Mock Express res recording status + json -------------------------------------
function mockRes() {
  const calls = {
    status: undefined as number | undefined,
    json: undefined as unknown,
    statusCalls: 0,
    jsonCalls: 0,
  };
  const res = {
    status(code: number) {
      calls.status = code;
      calls.statusCalls += 1;
      return res;
    },
    json(body: unknown) {
      calls.json = body;
      calls.jsonCalls += 1;
      return res;
    },
  };
  return { res: res as unknown as Response, calls };
}

// --- Property 4 --------------------------------------------------------------------

describe('Property 4: Neutrality is enforced at every outbound boundary', () => {
  it('every legitimate lens-safe payload passes neutralityGuard', () => {
    fc.assert(
      fc.property(legitimatePayloadArb, (payload) => {
        const result = neutralityGuard(payload);
        assert.equal(
          result.pass,
          true,
          `legitimate payload was withheld (offendingKey=${result.offendingKey}): ${JSON.stringify(payload)}`,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('real Feed Friction overlay projections pass neutralityGuard', () => {
    fc.assert(
      fc.property(gateValidReportArbitrary, fc.webUrl(), (report, baseUrl) => {
        const overlay = projectFrictionOverlay(report, baseUrl);
        const result = neutralityGuard(overlay);
        assert.equal(
          result.pass,
          true,
          `friction overlay withheld (offendingKey=${result.offendingKey})`,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 5 --------------------------------------------------------------------

describe('Property 5: The neutrality guard withholds any failing payload', () => {
  it('delivers passing payloads unchanged and withholds failing ones entirely', () => {
    fc.assert(
      fc.property(
        fc.oneof(legitimatePayloadArb, adversarialPayloadArb),
        fc.integer({ min: 200, max: 299 }),
        (payload, status) => {
          const { res, calls } = mockRes();
          const passes = neutralityGuard(payload).pass;

          sendNeutral(res, status, payload);

          // Exactly one status + one json call regardless of outcome (no partial delivery).
          assert.equal(calls.statusCalls, 1, 'status() must be called exactly once');
          assert.equal(calls.jsonCalls, 1, 'json() must be called exactly once');

          if (passes) {
            // Delivered unchanged: same status, same payload reference.
            assert.equal(calls.status, status, 'passing payload must use the given status');
            assert.equal(
              calls.json,
              payload,
              'passing payload must be delivered unchanged (same reference)',
            );
          } else {
            // Withheld entirely: not the requested status, and the payload never sent.
            assert.notEqual(calls.status, status, 'failing payload must not use success status');
            assert.notEqual(calls.json, payload, 'failing payload must not be delivered');
            assert.deepEqual(
              calls.json,
              { error: 'not_found' },
              'withheld response carries only the not_found stub',
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('adversarial payloads are always withheld', () => {
    fc.assert(
      fc.property(adversarialPayloadArb, (payload) => {
        const { res, calls } = mockRes();
        sendNeutral(res, 200, payload);
        assert.notEqual(calls.json, payload, 'adversarial payload must never be delivered');
        assert.deepEqual(calls.json, { error: 'not_found' });
      }),
      { numRuns: 200 },
    );
  });
});

// --- Property 6 --------------------------------------------------------------------

describe('Property 6: The neutrality guard is total', () => {
  it('returns a boolean-pass result without throwing for any input', () => {
    const anyInput = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.anything({
        withBigInt: true,
        withDate: true,
        withMap: true,
        withSet: true,
        withObjectString: true,
        withNullPrototype: true,
      }),
    );

    fc.assert(
      fc.property(anyInput, (input) => {
        let result: ReturnType<typeof neutralityGuard> | undefined;
        assert.doesNotThrow(() => {
          result = neutralityGuard(input);
        });
        assert.equal(typeof result!.pass, 'boolean');
      }),
      { numRuns: 300 },
    );
  });

  it('handles cyclic objects and arrays without throwing', () => {
    // Cyclic object graph.
    const cyclic: Record<string, unknown> = { reportId: 'r1', nested: {} };
    cyclic.self = cyclic;
    (cyclic.nested as Record<string, unknown>).back = cyclic;
    assert.doesNotThrow(() => neutralityGuard(cyclic));
    assert.equal(typeof neutralityGuard(cyclic).pass, 'boolean');

    // Cyclic array.
    const arr: unknown[] = [{ claimText: 'x' }];
    arr.push(arr);
    assert.doesNotThrow(() => neutralityGuard(arr));
    assert.equal(typeof neutralityGuard(arr).pass, 'boolean');

    // Mutual cycle across two objects.
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    a.b = b;
    b.a = a;
    assert.doesNotThrow(() => neutralityGuard(a));
  });
});
