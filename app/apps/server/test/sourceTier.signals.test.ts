// Feature: trust-and-launch-bundle, Property 2: Tier equals the highest-ranked matching open signal.
// For ANY source URL with a resolvable publishing host, classifyCitationTier returns the tier of
// the highest-ranked open signal that matches the host; with no matching signal it returns
// tier3_viewpoint; and for any string whose host cannot resolve to a valid publishing domain it
// returns excluded. (IFCN signatories and institutional-registry hosts are therefore always at
// least tier2_institutional.)
// Validates: Requirements 2.3, 2.4, 2.8, 2.10, 2.11

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { classifyCitationTier, TIER_RANK } from '../src/core/sourceTier';
import {
  IFCN_SIGNATORIES,
  PRIMARY_SOURCE_DOMAINS,
  INSTITUTIONAL_DOMAINS,
  INSTITUTIONAL_SUFFIX_RULES,
  PRESS_COUNCIL_MEMBERS,
} from '../src/core/data/sourceSignals';
import type { SourceTier } from '../src/types';

// --- Independent oracle (a reimplementation of the policy used only as a reference) ---
// Registrable-parent candidates for a host: host, then each parent down to (excluding) the TLD.
function candidates(host: string): string[] {
  const labels = host.split('.');
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join('.'));
  return out;
}

function matchedTiers(host: string): SourceTier[] {
  const cands = candidates(host);
  const onSet = (set: ReadonlySet<string>) => cands.some((c) => set.has(c));
  const tiers: SourceTier[] = [];
  if (onSet(IFCN_SIGNATORIES)) tiers.push('tier2_institutional');
  if (onSet(PRIMARY_SOURCE_DOMAINS)) tiers.push('tier1_primary');
  if (onSet(INSTITUTIONAL_DOMAINS)) tiers.push('tier2_institutional');
  if (INSTITUTIONAL_SUFFIX_RULES.some((re) => re.test(`.${host}`))) tiers.push('tier2_institutional');
  if (onSet(PRESS_COUNCIL_MEMBERS)) tiers.push('tier2_institutional');
  return tiers;
}

// Expected tier for a (lowercase, www-free) host — the highest-ranked matching signal, or
// tier3_viewpoint when none match. Used as the oracle for the 2.10 max-rank property.
function oracleTier(host: string): SourceTier {
  const tiers = matchedTiers(host);
  if (tiers.length === 0) return 'tier3_viewpoint';
  return tiers.reduce((best, t) => (TIER_RANK[t] > TIER_RANK[best] ? t : best));
}

const matchesAnySignal = (host: string) => matchedTiers(host).length > 0;

// --- Generators ---
const TIER2 = TIER_RANK.tier2_institutional;

const lowerLabel = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 5, maxLength: 12 })
  .map((a) => a.join(''));

// Wrap a host arbitrary into a realistic source URL: optional scheme, an inert subdomain
// (www. is stripped by the policy; the others add no seeded parent), and an optional path.
const urlFrom = (hostArb: fc.Arbitrary<string>) =>
  fc
    .record({
      host: hostArb,
      scheme: fc.constantFrom('https://', 'http://', ''),
      sub: fc.constantFrom('', 'www.', 'news.', 'm.'),
      path: fc.constantFrom('', '/', '/article', '/a/b?x=1', '#frag'),
    })
    .map(({ host, scheme, sub, path }) => `${scheme}${sub}${host}${path}`);

const ifcnHost = fc.constantFrom(...IFCN_SIGNATORIES);
const primaryHost = fc.constantFrom(...PRIMARY_SOURCE_DOMAINS);
const institutionalRegistryHost = fc.constantFrom(...INSTITUTIONAL_DOMAINS, ...PRESS_COUNCIL_MEMBERS);

// Synthetic hosts whose suffix triggers an institutional suffix rule (.gov/.gov.*/.mil/.edu/.ac.*/.int).
const suffixHost = fc
  .record({
    label: lowerLabel,
    suffix: fc.constantFrom('.gov', '.gov.uk', '.gov.au', '.mil', '.edu', '.ac.uk', '.ac.jp', '.int'),
  })
  .map(({ label, suffix }) => `${label}${suffix}`);

// Hosts that match NO open signal: a random label on a non-institutional TLD, filtered through
// the oracle to guarantee no incidental collision with any seeded set or suffix rule.
const noMatchHost = fc
  .record({
    sld: lowerLabel,
    tld: fc.constantFrom('com', 'net', 'org', 'io', 'co', 'info', 'app', 'dev', 'xyz', 'site', 'blog'),
  })
  .map(({ sld, tld }) => `${sld}.${tld}`)
  .filter((host) => !matchesAnySignal(host));

// Inputs that cannot resolve to a valid publishing host.
const unresolvable = fc.oneof(
  fc.constantFrom('', '   ', '\t', 'not a url', 'localhost', 'http://', 'https://', 'foo', 'a b c', '::1', 'mailto:x@y'),
  lowerLabel, // bare single-label token, no dot
  fc
    .tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    )
    .map((octets) => octets.join('.')), // IPv4-like: numeric TLD is not a publishing host
);

// --- Properties ---

test('Property 2 (2.3): an IFCN-signatory host is at least tier2_institutional', () => {
  fc.assert(
    fc.property(urlFrom(ifcnHost), (url) => {
      assert.ok(
        TIER_RANK[classifyCitationTier(url)] >= TIER2,
        `IFCN host ${url} classified below tier2: ${classifyCitationTier(url)}`,
      );
    }),
    { numRuns: 100 },
  );
});

test('Property 2 (2.4): a primary-source host classifies as tier1_primary', () => {
  fc.assert(
    fc.property(urlFrom(primaryHost), (url) => {
      assert.equal(classifyCitationTier(url), 'tier1_primary');
    }),
    { numRuns: 100 },
  );
});

test('Property 2 (2.4): institutional-registry, suffix-rule, and press-council hosts are at least tier2', () => {
  fc.assert(
    fc.property(urlFrom(fc.oneof(institutionalRegistryHost, suffixHost)), (url) => {
      assert.ok(
        TIER_RANK[classifyCitationTier(url)] >= TIER2,
        `institutional host ${url} classified below tier2: ${classifyCitationTier(url)}`,
      );
    }),
    { numRuns: 100 },
  );
});

test('Property 2 (2.8): a host matching no open signal classifies as tier3_viewpoint', () => {
  fc.assert(
    fc.property(urlFrom(noMatchHost), (url) => {
      assert.equal(classifyCitationTier(url), 'tier3_viewpoint');
    }),
    { numRuns: 100 },
  );
});

test('Property 2 (2.10): the result equals the highest-ranked matching open signal', () => {
  // Cover single- and multi-signal hosts (e.g. a primary domain that also matches a suffix rule)
  // and verify the policy picks the max-rank tier independently computed by the oracle.
  const anyHost = fc.oneof(ifcnHost, primaryHost, institutionalRegistryHost, suffixHost, noMatchHost);
  fc.assert(
    fc.property(
      fc.record({
        host: anyHost,
        scheme: fc.constantFrom('https://', 'http://', ''),
        sub: fc.constantFrom('', 'www.', 'news.', 'm.'),
        path: fc.constantFrom('', '/', '/x?y=1'),
      }),
      ({ host, scheme, sub, path }) => {
        const url = `${scheme}${sub}${host}${path}`;
        assert.equal(classifyCitationTier(url), oracleTier(host));
      },
    ),
    { numRuns: 100 },
  );
});

test('Property 2 (2.11): a string with no resolvable publishing host classifies as excluded', () => {
  fc.assert(
    fc.property(unresolvable, (input) => {
      assert.equal(classifyCitationTier(input), 'excluded');
    }),
    { numRuns: 100 },
  );
});
