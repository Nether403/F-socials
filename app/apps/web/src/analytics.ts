// Web_Analytics — a tiny consent-gated wrapper over posthog-js (Req 12.3–12.7).
//
// The web analogue of the server's Redactor + Neutrality_Guard. Three rules hold the
// Compass and the PII trust boundary at the web emission point:
//   - No key (`VITE_POSTHOG_KEY` unset) ⇒ `track` is a no-op that returns within the
//     same synchronous tick, opens zero connections, and never blocks render (Req 12.4).
//   - Until analytics consent is granted, `track` emits nothing; after `grantConsent()`
//     subsequent calls emit (Req 12.5, 12.6). Consent is a single `localStorage`
//     boolean (`fs_analytics_consent`).
//   - Every payload passes through the pure `buildWebEvent` before emission, which
//     strips raw claim text, transcript text, JWTs, and user identifiers, and any
//     creator/channel reliability dimension or content-truth verdict (Req 12.3).
//   - Any outbound failure is swallowed silently — `track` is fire-and-forget with no
//     render side effects, so the DOM, hash routing, and a11y tree are identical
//     whether analytics is active or a no-op (Req 12.7, 12.8).
//
// posthog-js is the ONLY vendor SDK touched here; it is initialized lazily on the first
// emit after consent, never at import, so module load has zero side effects.

import posthog from 'posthog-js';

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const CONSENT_KEY = 'fs_analytics_consent';

// --- Pure payload sanitizer (the web Redactor + Neutrality_Guard) ------------------

// Case-insensitive SUBSTRING deny-list: a key is dropped entirely if its lower-cased
// form contains any token. Report ids, content ids, hashes, routes, and categorical
// labels carry none of these, so they survive unchanged.
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
] as const;

// Person/creator/channel identity tokens and reliability-dimension tokens. A key that
// fuses the two (creatorReliability, channelTrust, authorTier) — or a dimension key
// co-located with a person key in the same object — is a person-attached rating and is
// stripped (Req 12.3). A bare source tier (no person token, no person co-located)
// survives, since tiers legitimately describe a source/citation.
const PERSON = ['creator', 'author', 'channel', 'person', 'uploader', 'influencer', 'contributor', 'byline'];
const DIMENSION = ['reliability', 'credibility', 'trustworthiness', 'trust', 'reputation', 'tier', 'rating'];
// Content-truth verdicts are forbidden outright — no person needed.
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

const CIRCULAR = '[Circular]';

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hasAny(n: string, tokens: readonly string[]): boolean {
  return tokens.some((t) => n.includes(t));
}

function isDeniedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return DENIED_KEYS.some((d) => lower.includes(d));
}

// Pure, total deep-sanitize: returns a copy with offending keys dropped at every depth.
// Cyclic references resolve to a marker (a WeakSet tracks the ancestor path) so the
// function is total over any input and never throws.
function sanitize(value: unknown, path: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (path.has(value)) return CIRCULAR;
  path.add(value);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((el) => sanitize(el, path));
  } else {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const hasPerson = keys.some((k) => hasAny(norm(k), PERSON));
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const n = norm(k);
      if (isDeniedKey(k)) continue; // raw claim/transcript text, JWTs, user ids
      if (hasAny(n, TRUTH_VERDICT)) continue; // content-truth verdict
      if (hasAny(n, PERSON) && hasAny(n, DIMENSION)) continue; // fused creator rating
      if (hasPerson && hasAny(n, DIMENSION)) continue; // dimension co-located with a person
      out[k] = sanitize(obj[k], path);
    }
    result = out;
  }

  path.delete(value);
  return result;
}

// Pure: shape a web Telemetry_Event, stripping every Denied_Field and any
// creator/channel reliability dimension or content-truth verdict (Req 12.3).
export function buildWebEvent(
  name: string,
  props: Record<string, unknown>,
): { name: string; props: Record<string, unknown> } {
  const sanitized = sanitize(props ?? {}, new WeakSet<object>()) as Record<string, unknown>;
  return { name, props: sanitized };
}

// --- Consent + emission ------------------------------------------------------------

// True only when the reader has granted analytics consent. localStorage access is
// wrapped because it can throw (private mode, disabled storage) — a failure reads as
// "no consent" so we default to emitting nothing.
export function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'true';
  } catch {
    return false;
  }
}

// Record consent so subsequent track() calls may emit (Req 12.6).
export function grantConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, 'true');
  } catch {
    // Storage unavailable — consent simply won't persist; never throw to the caller.
  }
}

let initialized = false;

// Lazily initialize posthog-js on the first emit after consent. autocapture and
// pageview capture are disabled so the SDK adds no DOM listeners or render side
// effects; we drive every event explicitly through track().
function client(): typeof posthog | undefined {
  if (!KEY) return undefined;
  if (!initialized) {
    posthog.init(KEY, {
      api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com',
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      persistence: 'localStorage',
    });
    initialized = true;
  }
  return posthog;
}

// Fire-and-forget. No key ⇒ synchronous no-op, zero outbound (Req 12.4). No consent ⇒
// emits nothing (Req 12.5). Any failure is discarded silently so render/routing/a11y
// are never affected (Req 12.7). Has no render side effects (Req 12.8).
export function track(name: string, props: Record<string, unknown> = {}): void {
  if (!KEY) return;
  if (!hasConsent()) return;
  try {
    const event = buildWebEvent(name, props);
    client()?.capture(event.name, event.props);
  } catch {
    // Swallow — telemetry is fail-open and must never disrupt the UI.
  }
}
