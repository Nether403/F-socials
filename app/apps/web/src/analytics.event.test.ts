// Feature: observability-instrumentation, Property 13: Web events carry no PII or
// creator dimension and degrade to a no-op.
// Validates: Requirements 12.3, 12.4
//
// Two universal guarantees of the web analytics wrapper:
//   1. buildWebEvent (the web Redactor + Neutrality_Guard) returns an event whose
//      props — at every depth — carry no raw claim/transcript text, no JWT, no user
//      id, and no creator/channel reliability dimension. We seed arbitrarily nested
//      payloads with denied keys and fused creator-reliability keys and assert none
//      survive the build.
//   2. While VITE_POSTHOG_KEY is unset, track() is a synchronous no-op: for any
//      sequence of track calls it returns void within the same tick, never throws,
//      and opens zero outbound emission (the mocked posthog-js client is never
//      initialized and capture is never called) — even after consent is granted, so
//      the missing key (not consent) is what holds the line.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Spy on the only vendor SDK. If track() ever reached an emit, these would fire;
// with VITE_POSTHOG_KEY unset they must stay untouched (zero outbound).
const { captureSpy, initSpy } = vi.hoisted(() => ({ captureSpy: vi.fn(), initSpy: vi.fn() }));
vi.mock('posthog-js', () => ({ default: { init: initSpy, capture: captureSpy } }));

import { buildWebEvent, track, grantConsent } from './analytics';

// The key MUST be absent for the no-op half of the property to be meaningful.
const KEY_UNSET = !import.meta.env.VITE_POSTHOG_KEY;

// --- Independent detectors for a "bad" key (mirror the contract, not the impl) -----
const DENIED = [
  'transcript', 'claimtext', 'rawclaim', 'jwt', 'token', 'apikey', 'api_key',
  'authorization', 'secret', 'password', 'userid', 'user_id', 'email',
];
const PERSON = ['creator', 'author', 'channel', 'person', 'uploader', 'influencer', 'contributor', 'byline'];
const DIMENSION = ['reliability', 'credibility', 'trustworthiness', 'trust', 'reputation', 'tier', 'rating'];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const isDenied = (k: string) => DENIED.some((d) => k.toLowerCase().includes(d));
// Fused creator-reliability key, e.g. creatorReliability / channelTrust / authorTier.
const isCreatorDimension = (k: string) => {
  const n = norm(k);
  return PERSON.some((p) => n.includes(p)) && DIMENSION.some((d) => n.includes(d));
};

// Keys we deliberately inject so the redactor has something to strip at any depth.
const BAD_KEYS = [
  'transcript', 'claimText', 'rawClaim', 'jwt', 'token', 'apiKey', 'authorization',
  'secret', 'password', 'userId', 'email',
  'creatorReliability', 'channelTrust', 'authorTier', 'authorCredibility',
  'personReputation', 'uploaderRating', 'influencerTrust',
];
const SAFE_KEYS = ['reportId', 'route', 'count', 'status', 'sourceTier', 'durationMs', 'contentHash'];

// Collect every object key reachable in the value (cycle-safe).
function collectKeys(value: unknown, seen: WeakSet<object>, out: string[]): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const el of value) collectKeys(el, seen, out);
    return;
  }
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out.push(k);
    collectKeys((value as Record<string, unknown>)[k], seen, out);
  }
}

// A property bag that mixes safe keys, denied keys, and fused creator keys at depth.
const keyArb = fc.oneof(fc.constantFrom(...SAFE_KEYS), fc.constantFrom(...BAD_KEYS), fc.string());
const propsArb: fc.Arbitrary<Record<string, unknown>> = fc.letrec((tie) => ({
  leaf: fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
  node: fc.oneof(
    { withCrossShrink: true },
    tie('leaf'),
    fc.array(tie('node') as fc.Arbitrary<unknown>, { maxLength: 4 }),
    fc.dictionary(keyArb, tie('node') as fc.Arbitrary<unknown>, { maxKeys: 5 }),
  ),
  root: fc.dictionary(keyArb, tie('node') as fc.Arbitrary<unknown>, { minKeys: 1, maxKeys: 6 }),
})).root as fc.Arbitrary<Record<string, unknown>>;

describe('Property 13: web events carry no PII/creator dimension and degrade to a no-op', () => {
  beforeEach(() => {
    captureSpy.mockClear();
    initSpy.mockClear();
  });

  it('buildWebEvent strips denied keys and creator/channel reliability dimensions at every depth', () => {
    fc.assert(
      fc.property(fc.string(), propsArb, (name, props) => {
        const event = buildWebEvent(name, props);
        expect(event.name).toBe(name);
        const keys: string[] = [];
        collectKeys(event.props, new WeakSet<object>(), keys);
        for (const k of keys) {
          expect(isDenied(k), `denied key survived: ${k}`).toBe(false);
          expect(isCreatorDimension(k), `creator dimension survived: ${k}`).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('track is a synchronous no-op with zero outbound while VITE_POSTHOG_KEY is unset', () => {
    expect(KEY_UNSET, 'VITE_POSTHOG_KEY must be unset for this property').toBe(true);
    // Consent granted on purpose: proves the absent key — not consent — gates emission.
    grantConsent();
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.string(), propsArb), { maxLength: 8 }),
        (calls) => {
          for (const [name, props] of calls) {
            const returned = track(name, props);
            expect(returned).toBeUndefined(); // synchronous void, not a thenable
          }
          expect(initSpy).not.toHaveBeenCalled();
          expect(captureSpy).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });
});
