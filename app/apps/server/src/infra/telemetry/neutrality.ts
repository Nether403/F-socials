// Neutrality_Guard — the Compass at the telemetry emission boundary.
//
// f-Socials is a "lens, not a judge": no telemetry payload may carry a reliability /
// credibility / trust rating tied to a content creator, author, person, or channel,
// nor a truthfulness / accuracy verdict about analyzed content. `neutralityGuard`
// is the pure, total check the active Telemetry_Port runs over every Telemetry_Event
// before it reaches Product_Analytics (Req 6.1–6.6); a failing event is withheld
// entirely (the port's job — Req 6.6), so this function only ever decides pass/fail
// and names the offending key.
//
// Source tiers are the one place a "tier" legitimately appears — but ONLY when they
// describe a source / citation. A tier that is baked into a person key
// (`creatorTier`, `authorTier`) or co-located in the same object with a creator /
// channel / author / person identifier is a person-attached rating and fails
// (Req 6.3). `sourceTier` standing on its own (or beside a citation/source id) passes.
//
// Total over ANY input — null, undefined, primitives, arrays, deeply nested objects,
// and cyclic references — never throwing (Req 6.7). A WeakSet of visited objects makes
// a cycle terminate instead of recursing forever; a node already seen contributes no
// new offense, so stopping there is sound.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export interface NeutralityResult {
  pass: boolean;
  offendingKey?: string;
}

// Normalize a key/value string to bare lowercase alphanumerics so `creatorReliability`,
// `creator_reliability`, and `Creator-Reliability` all collapse to one comparable form.
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A person/creator/channel identity. Deliberately narrow (the Compass names
// creator/author/person/channel) plus unambiguous synonyms — we do NOT include
// host/account/source, which legitimately accompany a source tier and would cause a
// source-tier-only event to false-fail the co-location rule.
const PERSON = [
  'creator',
  'author',
  'channel',
  'person',
  'uploader',
  'influencer',
  'contributor',
  'byline',
];

// A reliability / trust rating dimension. `tier` lives here so a person-attached tier
// (creatorTier / a tier beside a creator id) fails, while a bare `sourceTier` — no
// person token, no person co-located — passes.
const DIMENSION = [
  'reliability',
  'credibility',
  'trustworthiness',
  'trust',
  'reputation',
  'tier',
  'rating',
];

// A truthfulness / accuracy verdict about content — forbidden outright (Req 6.2),
// no person needed. `evidenceOutcome` / `evidenceStrength` / `status` / `reasons`
// and the rest of the legitimate vocabulary contain none of these substrings.
const TRUTH_VERDICT = [
  'truthverdict',
  'factverdict',
  'accuracyverdict',
  'contentverdict',
  'factcheckverdict',
  'accuracyrating',
  'truthrating',
  'truthscore',
  'accuracyscore',
  'truthfulness',
  'veracity',
  'istrue',
  'isfalse',
  'isaccurate',
  'isfactual',
  'isfake',
  'ismisinformation',
  'isdisinformation',
  'verdict',
];

function hasAny(normalized: string, tokens: readonly string[]): boolean {
  return tokens.some((t) => normalized.includes(t));
}

// A single string (a key, or a string value) is offending on its own when it expresses
// a content-truth verdict, or fuses a person identity with a rating dimension
// (`creatorReliability`, `channelTrust`, `authorTier`).
function stringIsOffending(raw: string): boolean {
  const n = norm(raw);
  if (hasAny(n, TRUTH_VERDICT)) return true;
  return hasAny(n, PERSON) && hasAny(n, DIMENSION);
}

// Returns the offending key (or the holding key for an offending value) or null.
// `keyContext` is the key under which the current value sits, so an offending array
// element or scalar can still name a key in the result.
function walk(value: unknown, keyContext: string | undefined, seen: WeakSet<object>): string | null {
  if (typeof value === 'string') {
    return stringIsOffending(value) ? keyContext ?? value : null;
  }
  if (value === null || typeof value !== 'object') return null;

  // Cycle / already-visited: this node adds no new offense, so stop (totality, Req 6.7).
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = walk(item, keyContext, seen);
      if (hit) return hit;
    }
    return null;
  }

  const keys = Object.keys(value as Record<string, unknown>);

  // Key-level: a single key that fuses person+dimension or names a content verdict.
  for (const k of keys) {
    const n = norm(k);
    if (hasAny(n, TRUTH_VERDICT)) return k;
    if (hasAny(n, PERSON) && hasAny(n, DIMENSION)) return k;
  }

  // Co-location (Req 6.3): a rating dimension key sitting in the same object as a
  // person/creator/channel identity key is a person-attached rating — report the
  // dimension key, since that is the field that must not be person-attached.
  const dimensionKey = keys.find((k) => hasAny(norm(k), DIMENSION));
  const personKey = keys.find((k) => hasAny(norm(k), PERSON));
  if (dimensionKey && personKey) return dimensionKey;

  // Recurse into values, carrying the key for offending-value attribution.
  for (const k of keys) {
    const hit = walk((value as Record<string, unknown>)[k], k, seen);
    if (hit) return hit;
  }
  return null;
}

// Pure, total. `{ pass: true }` when neither a creator/person/channel reliability
// dimension nor a content-truth verdict is present; `{ pass: false, offendingKey }`
// otherwise. Never throws for any input (Req 6.4, 6.7).
export function neutralityGuard(event: unknown): NeutralityResult {
  const offendingKey = walk(event, undefined, new WeakSet<object>());
  return offendingKey === null ? { pass: true } : { pass: false, offendingKey };
}

// ponytail: one runnable self-check (run `node --import tsx src/infra/telemetry/neutrality.ts`).
// Full property coverage is task 2.7; this fails fast if the three load-bearing
// behaviors regress — source tier passes, person-attached rating fails with its key,
// cyclic input is total.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  // A source-tier-only event (tier describes a source/citation) passes.
  const sourceOnly = neutralityGuard({
    reportId: 'r1',
    sourceTier: 'tier1_institutional',
    citationId: 'c1',
    outcomeDistribution: { matched_fact_check: 2, no_sufficient_evidence: 1 },
  });
  assert.equal(sourceOnly.pass, true);
  assert.equal(sourceOnly.offendingKey, undefined);

  // A creator-reliability event fails and names the offending key.
  const creatorRating = neutralityGuard({ reportId: 'r1', creatorReliability: 0.9 });
  assert.equal(creatorRating.pass, false);
  assert.equal(creatorRating.offendingKey, 'creatorReliability');

  // A tier co-located with a creator identity fails (person-attached tier, Req 6.3).
  const coLocated = neutralityGuard({ tier: 'tier1', creatorId: 'bob' });
  assert.equal(coLocated.pass, false);
  assert.equal(coLocated.offendingKey, 'tier');

  // A content-truth verdict fails on its own (no person needed).
  assert.equal(neutralityGuard({ truthVerdict: 'false' }).pass, false);
  assert.equal(neutralityGuard({ isTrue: true }).pass, false);
  assert.equal(neutralityGuard({ accuracyRating: 5 }).pass, false);

  // Cyclic input returns without throwing (totality, Req 6.7).
  const cyclic: Record<string, unknown> = { reportId: 'r1', nested: { count: 3 } };
  cyclic.self = cyclic;
  (cyclic.nested as Record<string, unknown>).back = cyclic;
  assert.equal(neutralityGuard(cyclic).pass, true);

  // Null / undefined / primitives / arrays are total and benign.
  assert.equal(neutralityGuard(null).pass, true);
  assert.equal(neutralityGuard(undefined).pass, true);
  assert.equal(neutralityGuard(42).pass, true);
  assert.equal(neutralityGuard(['tier1', { reportId: 'r1' }]).pass, true);

  console.log('neutrality.ts self-check passed');
}
