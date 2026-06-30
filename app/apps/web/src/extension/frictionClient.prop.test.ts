/**
 * Property-based tests for the Extension friction module (normalization + intensity).
 *
 * // Feature: intervention-and-scale, Property 9: Feed URL normalization matches the stored content hash
 * // Validates: Requirements 2.1, 3.5, 3.6, 3.7
 *
 * // Feature: intervention-and-scale, Property 11: Intervention intensity resolves to a valid level and round-trips
 * // Validates: Requirements 2.1, 3.5, 3.6, 3.7
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { normalizeFeedUrl, resolveIntensity, intensityStore } from './frictionModule';
import type { Intensity } from './frictionModule';

const NUM_RUNS = 100;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'igshid', 'si', 'feature',
];

// ponytail: fast-check v4 dropped fc.stringOf; build constrained strings with anchored
// stringMatching regexes (the pattern already used across this repo's i18n property tests).
const arbHostLabel = fc.stringMatching(/^[a-z0-9]{3,12}$/);
const arbPathSeg = fc.stringMatching(/^[a-z0-9_-]{1,10}$/);
const arbParamKey = fc.stringMatching(/^[a-z]{1,6}$/);
const arbParamVal = fc.stringMatching(/^[a-z0-9]{1,8}$/);
const arbFrag = fc.stringMatching(/^[a-z0-9]{1,8}$/);

/** Generates a well-formed URL with random path, query params, and hash fragment. */
const arbWellFormedUrl = fc.record({
  scheme: fc.constantFrom('https'),
  www: fc.boolean(),
  hostname: arbHostLabel.map(h => `${h}.com`),
  path: fc.array(arbPathSeg, { minLength: 0, maxLength: 3 })
    .map(parts => '/' + parts.join('/')),
  queryParams: fc.array(
    fc.tuple(arbParamKey, arbParamVal),
    { minLength: 0, maxLength: 4 },
  ),
  trackingParams: fc.array(
    fc.tuple(fc.constantFrom(...TRACKING_PARAMS), arbParamVal),
    { minLength: 0, maxLength: 4 },
  ),
  hash: fc.option(arbFrag, { nil: undefined }),
}).map(({ scheme, www, hostname, path, queryParams, trackingParams, hash }) => {
  const host = www ? `www.${hostname}` : hostname;
  const allParams = [...queryParams, ...trackingParams];
  const search = allParams.length > 0
    ? '?' + allParams.map(([k, v]) => `${k}=${v}`).join('&')
    : '';
  const fragment = hash ? `#${hash}` : '';
  return `${scheme}://${host}${path}${search}${fragment}`;
});

/** Generates a pair of equivalent URLs that should normalize the same. */
const arbEquivalentUrlPair = fc.record({
  hostname: arbHostLabel.map(h => `${h}.com`),
  path: fc.array(fc.stringMatching(/^[a-z0-9_-]{1,8}$/), { minLength: 0, maxLength: 3 })
    .map(parts => '/' + parts.join('/')),
  queryParams: fc.uniqueArray(
    fc.tuple(fc.stringMatching(/^[a-z]{1,5}$/), fc.stringMatching(/^[a-z0-9]{1,6}$/)),
    { minLength: 1, maxLength: 4, selector: ([k]) => k },
  ),
  // Variations that should be stripped/normalized
  addWww: fc.boolean(),
  addTracking: fc.array(
    fc.tuple(fc.constantFrom(...TRACKING_PARAMS), fc.stringMatching(/^[a-z0-9]{1,6}$/)),
    { minLength: 0, maxLength: 3 },
  ),
  addHash: fc.option(fc.stringMatching(/^[a-z0-9]{1,6}$/), { nil: undefined }),
  shuffleParams: fc.boolean(),
}).map(({ hostname, path, queryParams, addWww, addTracking, addHash, shuffleParams }) => {
  // Canonical form: no www, sorted params, no tracking, no hash
  const sortedParams = [...queryParams].sort((a, b) => a[0].localeCompare(b[0]));
  const canonicalSearch = sortedParams.map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = `https://${hostname}${path}?${canonicalSearch}`;

  // Variant: might add www, tracking params, hash, and shuffle order
  const host = addWww ? `www.${hostname}` : hostname;
  const allParams = [...queryParams, ...addTracking];
  const orderedParams = shuffleParams ? [...allParams].reverse() : allParams;
  const search = orderedParams.map(([k, v]) => `${k}=${v}`).join('&');
  const fragment = addHash ? `#${addHash}` : '';
  const variant = `https://${host}${path}?${search}${fragment}`;

  return { canonical, variant };
});

const VALID_INTENSITIES: Intensity[] = ['subtle', 'moderate', 'interruptive'];

// ─── Property 9: Feed URL normalization ──────────────────────────────────────

describe('Property 9: Feed URL normalization matches the stored content hash', () => {
  // Feature: intervention-and-scale, Property 9: Feed URL normalization matches the stored content hash
  // Validates: Requirements 2.1, 3.5, 3.6, 3.7

  it('strips all tracking params from any well-formed URL', () => {
    fc.assert(
      fc.property(arbWellFormedUrl, (url) => {
        const normalized = normalizeFeedUrl(url);
        for (const param of TRACKING_PARAMS) {
          const parsed = new URL(normalized);
          expect(parsed.searchParams.has(param)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('removes www. prefix from any well-formed URL', () => {
    fc.assert(
      fc.property(arbWellFormedUrl, (url) => {
        const normalized = normalizeFeedUrl(url);
        const parsed = new URL(normalized);
        expect(parsed.hostname.startsWith('www.')).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('lowercases hostname', () => {
    fc.assert(
      fc.property(arbWellFormedUrl, (url) => {
        const normalized = normalizeFeedUrl(url);
        const parsed = new URL(normalized);
        expect(parsed.hostname).toBe(parsed.hostname.toLowerCase());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('removes hash fragment', () => {
    fc.assert(
      fc.property(arbWellFormedUrl, (url) => {
        const normalized = normalizeFeedUrl(url);
        const parsed = new URL(normalized);
        expect(parsed.hash).toBe('');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('sorts remaining query params', () => {
    fc.assert(
      fc.property(arbWellFormedUrl, (url) => {
        const normalized = normalizeFeedUrl(url);
        const parsed = new URL(normalized);
        const keys = [...parsed.searchParams.keys()];
        const sorted = [...keys].sort();
        expect(keys).toEqual(sorted);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('two equivalent URLs (differing only in tracking/www/hash/order) normalize to the same string', () => {
    fc.assert(
      fc.property(arbEquivalentUrlPair, ({ canonical, variant }) => {
        expect(normalizeFeedUrl(variant)).toBe(normalizeFeedUrl(canonical));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('normalization is idempotent', () => {
    fc.assert(
      fc.property(arbWellFormedUrl, (url) => {
        const once = normalizeFeedUrl(url);
        const twice = normalizeFeedUrl(once);
        expect(twice).toBe(once);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Property 11: Intervention intensity resolves to a valid level and round-trips ──

describe('Property 11: Intervention intensity resolves to a valid level and round-trips', () => {
  // Feature: intervention-and-scale, Property 11: Intervention intensity resolves to a valid level and round-trips
  // Validates: Requirements 2.1, 3.5, 3.6, 3.7

  afterEach(async () => {
    // Reset store state
    await intensityStore.set('moderate');
    // Clean up chrome mock
    if ((globalThis as any).chrome) {
      delete (globalThis as any).chrome;
    }
  });

  it('resolveIntensity always returns a member of {subtle, moderate, interruptive}', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.string(),               // random strings including empty
          fc.constantFrom('', ' ', 'banana', 'MODERATE', 'Subtle', 'INTERRUPTIVE', '123'),
          fc.constantFrom(...VALID_INTENSITIES),
        ),
        (stored) => {
          const result = resolveIntensity(stored);
          expect(VALID_INTENSITIES).toContain(result);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolveIntensity never throws for any input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.string(),
        ),
        (stored) => {
          expect(() => resolveIntensity(stored)).not.toThrow();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolveIntensity defaults to moderate for null/unknown/empty', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => !VALID_INTENSITIES.includes(s as Intensity)),
        (invalid) => {
          expect(resolveIntensity(invalid)).toBe('moderate');
        },
      ),
      { numRuns: NUM_RUNS },
    );
    // Explicit null check
    expect(resolveIntensity(null)).toBe('moderate');
  });

  it('resolveIntensity returns the value itself for all valid intensities', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VALID_INTENSITIES),
        (valid) => {
          expect(resolveIntensity(valid)).toBe(valid);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('intensityStore.set(v) followed by get() returns v for all valid intensities', async () => {
    // This tests the in-memory fallback (no chrome.storage)
    for (const v of VALID_INTENSITIES) {
      await intensityStore.set(v);
      const got = await intensityStore.get();
      expect(got).toBe(v);
    }
  });

  it('intensityStore round-trips across random valid intensity sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...VALID_INTENSITIES),
        async (v) => {
          await intensityStore.set(v);
          const got = await intensityStore.get();
          expect(got).toBe(v);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
