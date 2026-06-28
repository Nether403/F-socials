// Feature: observability-instrumentation, Property 5: Neutrality_Guard correctness and totality
// Validates: Requirements 6.4, 6.7, 6.1, 6.2, 6.3, 6.5, 8.8, 11.4
//
// neutralityGuard is the pure, total Compass check at the telemetry boundary. This
// suite pins four facets across ≥100 runs each:
//   (totality, 6.7/6.4) it returns a { pass } object — never throws — for ANY input,
//     including null/undefined/primitives/arrays/deeply-nested and cyclic references;
//   (passes, 6.1/6.2/6.5/11.4) an event built only from neutral ids/labels/counts and a
//     bare source tier carries neither a creator/person/channel reliability dimension nor
//     a content-truth verdict, so it passes;
//   (fails, 6.1/6.2/6.4/8.8) an event that fuses a person token with a rating dimension
//     (creatorReliability), co-locates a person identity with a rating dimension, or
//     names a content-truth verdict (truthVerdict / isTrue / accuracyRating) fails and
//     names an offending key — at any nesting depth;
//   (source-tier discrimination, 6.3) a source tier passes only when it stands beside a
//     source/citation id, and fails when co-located with a creator/channel/author/person.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { neutralityGuard } from '../src/infra/telemetry/neutrality';

const RUNS = { numRuns: 200 };

// ---------------------------------------------------------------------------
// Neutral building blocks — keys with NO person token and NO truth-verdict
// token (sourceTier is the one allowed dimension key, describing a source).
// Values drawn from a fixed neutral pool so a random string can never smuggle
// in a person+dimension fusion or a verdict substring.
// ---------------------------------------------------------------------------
const SAFE_KEYS = [
  'reportId',
  'contentId',
  'contentHash',
  'submissionId',
  'claimId',
  'citationId',
  'sourceId',
  'stage',
  'providerCategory',
  'count',
  'durationMs',
  'status',
  'outcomeDistribution',
  'evidenceOutcome',
  'sourceTier', // the one legitimate dimension key — describes a source
  'nested',
  'items',
] as const;

const SAFE_STRINGS = [
  'r1',
  'c1',
  's1',
  'tier1_primary',
  'tier2_institutional',
  'matched_fact_check',
  'no_sufficient_evidence',
  'relevant_context_only',
  'ready',
  'needs_review',
  'llm',
  'evidence',
] as const;

const safeScalar = fc.oneof(
  fc.constantFrom(...SAFE_STRINGS),
  fc.integer({ min: 0, max: 1_000_000 }),
  fc.boolean(),
);

// A recursively-nested neutral event: only SAFE_KEYS, only neutral scalars,
// arbitrary arrays/objects underneath. Guaranteed to contain no offending
// construct, so neutralityGuard must pass it.
const { safeValue } = fc.letrec<{ safeValue: unknown }>((tie) => ({
  safeValue: fc.oneof(
    { weight: 4, arbitrary: safeScalar },
    { weight: 1, arbitrary: fc.array(tie('safeValue'), { maxLength: 4 }) },
    {
      weight: 1,
      arbitrary: fc.dictionary(fc.constantFrom(...SAFE_KEYS), tie('safeValue'), { maxKeys: 5 }),
    },
  ),
}));

const passingEvent = fc.dictionary(fc.constantFrom(...SAFE_KEYS), safeValue, { maxKeys: 6 });

// Always-includes-a-bare-source-tier variant (tier beside a citation/source id).
const passingWithTier = passingEvent.map((o) => ({
  ...o,
  sourceTier: 'tier1_primary',
  citationId: 'c1',
  sourceId: 's1',
}));

// ---------------------------------------------------------------------------
// Offending building blocks.
// ---------------------------------------------------------------------------
const PERSON_TOKENS = [
  'creator',
  'author',
  'channel',
  'person',
  'uploader',
  'influencer',
  'contributor',
  'byline',
] as const;

// Capitalized dimension fragments so `${person}${Dim}` reads as a real key.
const DIM_FRAGMENTS = ['Reliability', 'Credibility', 'Trustworthiness', 'Trust', 'Reputation', 'Tier', 'Rating'] as const;

// person + dimension fused into ONE key/value: creatorReliability, channelTrust, authorTier.
const fusedString = fc
  .tuple(fc.constantFrom(...PERSON_TOKENS), fc.constantFrom(...DIM_FRAGMENTS))
  .map(([p, d]) => `${p}${d}`);

// A content-truth verdict — forbidden on its own, no person needed.
const verdictKey = fc.constantFrom(
  'truthVerdict',
  'factVerdict',
  'accuracyVerdict',
  'contentVerdict',
  'accuracyRating',
  'truthRating',
  'truthScore',
  'accuracyScore',
  'truthfulness',
  'veracity',
  'isTrue',
  'isFalse',
  'isAccurate',
  'isFactual',
  'isFake',
  'isMisinformation',
  'isDisinformation',
  'verdict',
);

// A person-identity key (person token, no dimension token) for the co-location rule.
const personIdKey = fc.constantFrom(
  'creatorId',
  'authorName',
  'channelId',
  'personId',
  'uploaderHandle',
  'influencerId',
  'contributorName',
  'byline',
);

// A bare rating-dimension key (dimension token, no person token).
const dimensionKey = fc.constantFrom('reliability', 'credibility', 'trustworthiness', 'trust', 'reputation', 'tier', 'rating');

// Each producer yields an object that neutralityGuard MUST fail.
const offendingEvent = fc.oneof(
  // (a) fused person+dimension KEY
  fusedString.map((k) => ({ [k]: 0.9 })),
  // (b) fused person+dimension VALUE under a neutral key
  fusedString.map((v) => ({ note: v })),
  // (c) content-truth verdict KEY
  verdictKey.map((k) => ({ [k]: true })),
  // (d) content-truth verdict VALUE under a neutral key
  verdictKey.map((v) => ({ label: v })),
  // (e) co-located person identity + rating dimension (person-attached rating)
  fc.tuple(personIdKey, dimensionKey).map(([p, d]) => ({ [p]: 'x', [d]: 'y' })),
);

// Bury an offending object under arbitrarily many neutral keys to exercise recursion.
const nestedOffending = fc.tuple(offendingEvent, fc.array(fc.constantFrom(...SAFE_KEYS), { maxLength: 4 })).map(
  ([off, path]) => {
    let cur: unknown = off;
    for (const k of path) cur = { [k]: cur };
    return cur;
  },
);

// ---------------------------------------------------------------------------
// Totality arbitrary: anything fast-check can build, plus explicit cyclic graphs
// and the bare null/undefined cases.
// ---------------------------------------------------------------------------
const cyclic = fc.dictionary(fc.string(), fc.anything(), { maxKeys: 5 }).map((seed) => {
  const o: Record<string, unknown> = { ...seed };
  o.self = o;
  o.nested = { back: o, count: 1 };
  return o;
});

const anyInput = fc.oneof(
  { weight: 5, arbitrary: fc.anything() },
  { weight: 1, arbitrary: cyclic },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
);

// ---------------------------------------------------------------------------
// Properties.
// ---------------------------------------------------------------------------

test('Property 5: neutralityGuard is total — returns a pass/fail result, never throws (6.7, 6.4)', () => {
  fc.assert(
    fc.property(anyInput, (input) => {
      const result = neutralityGuard(input);
      assert.equal(typeof result.pass, 'boolean');
      // offendingKey is present iff the result is a fail.
      assert.equal(result.pass, result.offendingKey === undefined);
    }),
    RUNS,
  );
});

test('Property 5: neutral events pass — no creator dimension, no truth verdict, bare source tier ok (6.1, 6.2, 6.5, 11.4)', () => {
  fc.assert(
    fc.property(fc.oneof(passingEvent, passingWithTier), (event) => {
      const result = neutralityGuard(event);
      assert.equal(result.pass, true);
      assert.equal(result.offendingKey, undefined);
    }),
    RUNS,
  );
});

test('Property 5: person-attached rating or content-truth verdict fails with an offending key (6.1, 6.2, 8.8)', () => {
  fc.assert(
    fc.property(fc.oneof(offendingEvent, nestedOffending), (event) => {
      const result = neutralityGuard(event);
      assert.equal(result.pass, false);
      assert.equal(typeof result.offendingKey, 'string');
    }),
    RUNS,
  );
});

test('Property 5: a source tier passes beside a source/citation but fails co-located with a person (6.3)', () => {
  // sourceTier standing with a source/citation id — describes a source — passes.
  fc.assert(
    fc.property(fc.constantFrom('tier1_primary', 'tier2_institutional', 'excluded'), (tier) => {
      const ok = neutralityGuard({ sourceTier: tier, citationId: 'c1', sourceId: 's1' });
      assert.equal(ok.pass, true);
    }),
    RUNS,
  );

  // The SAME source tier co-located with a creator/channel/author/person identity is a
  // person-attached rating and fails.
  fc.assert(
    fc.property(fc.constantFrom('tier1_primary', 'tier2_institutional'), personIdKey, (tier, person) => {
      const bad = neutralityGuard({ sourceTier: tier, [person]: 'someone' });
      assert.equal(bad.pass, false);
      assert.equal(typeof bad.offendingKey, 'string');
    }),
    RUNS,
  );
});
