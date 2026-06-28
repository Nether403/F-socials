// Telemetry PII/secret boundary: the Redactor (Req 5.1, 5.2, 5.3, 5.5, 5.6).
//
// `redact` is a PURE, TOTAL function. It returns a sanitized DEEP COPY of its input
// and never mutates the caller's object, never reads or writes external state
// (Req 5.1). Two scrubbing rules, applied at every depth of nested objects/arrays:
//   - Structural (key-based): any property whose key matches a Denied_Field key —
//     case-insensitive SUBSTRING match against DENIED_KEYS — is dropped entirely, so
//     no denied key survives in the output (Req 5.2).
//   - Value-based: any string value equal to a supplied denied literal (e.g. the
//     known JWT/transcript string handed in by the caller) is replaced with a
//     redaction marker, so it can't leak even if it slipped into a free-text field.
// Every non-denied field is preserved key-and-value unchanged — report ids, content
// ids, hashes, stage names, provider categories, counts, durations, Evidence_Outcome
// labels, etc. (Req 5.5).
//
// Totality (Req 5.6): null, undefined, primitives, arrays, deeply nested objects, and
// CYCLIC references all return without throwing. A WeakSet tracks the current
// ancestor path so a back-edge (cycle) resolves to a marker instead of recursing
// forever; a shared (non-cyclic) sub-object referenced twice is still expanded fully.
//
// Idempotence (Req 5.3) is immediate: a first pass removes every denied key and
// replaces every denied value with a marker, so a second pass finds nothing left to
// change and returns a deeply-equal payload.

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Case-insensitive SUBSTRING deny-list. A key matches if its lower-cased form
// contains any of these tokens at any position.
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

const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';

function isDeniedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return DENIED_KEYS.some((d) => lower.includes(d));
}

export function redact(payload: unknown, deniedValues?: ReadonlySet<string>): unknown {
  const path = new WeakSet<object>();

  function walk(value: unknown): unknown {
    // Primitives (incl. null, undefined, functions, symbols): copied by value. A
    // string value matching a supplied denied literal is scrubbed to a marker.
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string' && deniedValues?.has(value)) return REDACTED;
      return value;
    }

    // Cycle guard: a back-edge to an ancestor resolves to a marker, not recursion.
    if (path.has(value as object)) return CIRCULAR;
    path.add(value as object);

    let result: unknown;
    if (Array.isArray(value)) {
      result = value.map((el) => walk(el));
    } else {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (isDeniedKey(k)) continue; // drop denied key entirely (Req 5.2)
        out[k] = walk(v); // preserve non-denied key, recurse into value (Req 5.5)
      }
      result = out;
    }

    // Leave the ancestor path so a DAG (shared, non-cyclic ref) expands fully.
    path.delete(value as object);
    return result;
  }

  return walk(payload);
}

// Post-redaction residual assertion (Req 5.7): true if any Denied_Field KEY survives
// at any depth. Total over the same input space as `redact` (cycle-safe via WeakSet).
export function containsDeniedField(payload: unknown): boolean {
  const path = new WeakSet<object>();

  function walk(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false;
    if (path.has(value as object)) return false;
    path.add(value as object);

    let found = false;
    if (Array.isArray(value)) {
      found = value.some(walk);
    } else {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (isDeniedKey(k) || walk(v)) {
          found = true;
          break;
        }
      }
    }

    path.delete(value as object);
    return found;
  }

  return walk(payload);
}

// ponytail: one runnable self-check (run `node --import tsx src/infra/telemetry/redact.ts`).
// Full property coverage is tasks 2.2–2.5; this only fails fast if the core
// guarantees (no-denied-field, idempotence, non-mutation, value scrub, cycle-safety)
// regress.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  type Mutable = Record<string, unknown> & { self?: unknown };
  const payload: Mutable = {
    reportId: 'r1',
    durationMs: 42,
    outcome: 'matched_fact_check',
    nested: { jwt: 'a.b.c', stage: 'extraction', userId: 'u1', authorization: 'Bearer x' },
    items: [{ apiKey: 'k', sourceTier: 'tier2_institutional' }, { count: 3 }],
  };
  payload.self = payload; // cyclic reference

  const once = redact(payload) as Record<string, any>;

  // No denied key survives anywhere (Req 5.2), even behind the cycle.
  assert.equal(containsDeniedField(once), false);
  // Non-denied fields preserved key-and-value unchanged (Req 5.5).
  assert.equal(once.reportId, 'r1');
  assert.equal(once.durationMs, 42);
  assert.equal(once.outcome, 'matched_fact_check');
  assert.equal(once.nested.stage, 'extraction');
  assert.equal(once.items[0].sourceTier, 'tier2_institutional');
  assert.equal(once.items[1].count, 3);
  // Denied keys gone at depth.
  assert.equal('jwt' in once.nested, false);
  assert.equal('userId' in once.nested, false);
  assert.equal('authorization' in once.nested, false);
  assert.equal('apiKey' in once.items[0], false);
  // Cycle resolved to a marker, not an infinite structure.
  assert.equal(once.self, CIRCULAR);
  // Input was not mutated (Req 5.1).
  assert.equal(payload.nested && (payload.nested as any).jwt, 'a.b.c');
  assert.equal(payload.self, payload);
  // Idempotence: a second pass is deeply equal to the first (Req 5.3).
  assert.deepEqual(redact(once), once);
  // Value-based scrub: a known denied literal is removed even in a free-text field.
  const scrubbed = redact({ note: 'leaked-jwt-value' }, new Set(['leaked-jwt-value'])) as any;
  assert.notEqual(scrubbed.note, 'leaked-jwt-value');
  // Totality over odd inputs.
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
  assert.equal(redact(7), 7);
  assert.deepEqual(redact(['a', { token: 't' }]), ['a', {}]);

  console.log('redact.ts self-check passed');
}
