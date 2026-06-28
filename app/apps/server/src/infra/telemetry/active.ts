// Active Telemetry_Port — the ONLY module that touches a telemetry vendor SDK
// (@sentry/node for Error_Monitor, posthog-node for Product_Analytics). Every other
// server module speaks only the `Telemetry` interface (Req 1.5).
//
// Shape (design.md §3): a composite holding an OPTIONAL sentry client (for `capture`)
// and an OPTIONAL posthog client (for `emit`). Each concern is independently optional;
// when its client is absent that method is a no-op for that concern. The two init
// helpers (`initSentry` / `initPosthog`) are the single vendor-SDK touch points — the
// composition root (compose.ts selectTelemetry) calls them, builds the `deps`, and
// hands them to `makeActiveTelemetry`. Tests pass stub `deps` directly.
//
// Pipeline (both methods, fail-open by construction):
//   emit:    redact (PII boundary, Req 5.4) → suppress+warn if a denied field survived
//            (Req 5.7) → withhold if the Neutrality_Guard fails (Req 6.6) → posthog.
//   capture: redact (Req 4.4, 5.4) → sentry. (An error context is not a product event,
//            so it passes the Redactor but NOT the Neutrality_Guard — design.md.)
// Every send is wrapped in `safe()`: it swallows any synchronous throw / async
// rejection (logs once) and never awaits async work, so a telemetry fault can never
// propagate into the request path, the pipeline, or startup (Req 3.5, 9.7, 11.6, 11.7).

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { PostHog } from 'posthog-node';
import * as Sentry from '@sentry/node';

import type { Telemetry } from '../ports';
import { redact, containsDeniedField } from './redact';
import { neutralityGuard } from './neutrality';

// Defense-in-depth budget (Req 11.6). JS is single-threaded: we cannot preempt a
// synchronous SDK call mid-execution, so the budget is "best-effort" — async work is
// never awaited (the caller returns immediately) and a synchronous overrun is logged.
// ponytail: ceiling = cannot interrupt sync JS; upgrade path = move SDK sends to a
// worker thread if a vendor ever blocks the event loop past the budget.
const BUDGET_MS = 50;

export interface SentryBackend {
  captureException(error: unknown, context?: unknown): void;
}
export interface PostHogBackend {
  capture(args: { event: string; properties: Record<string, unknown> }): void;
}

export interface ActiveTelemetryDeps {
  sentry?: SentryBackend;
  posthog?: PostHogBackend;
}

export function makeActiveTelemetry(deps: ActiveTelemetryDeps): Telemetry {
  // "logs once" (design.md error table): the first swallowed fault is logged, the rest
  // are silently contained, so a hot failing path can't flood the logs. Per-instance.
  let faultLogged = false;
  const logFaultOnce = (where: string, err: unknown) => {
    if (faultLogged) return;
    faultLogged = true;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[telemetry] ${where} fault contained (fail-open): ${msg}`);
  };

  // Run a fire-and-forget send. Swallows synchronous throws; for a thenable result,
  // attaches a rejection handler WITHOUT awaiting (the budget = never block the caller).
  const safe = (where: string, fn: () => unknown): void => {
    const start = Date.now();
    try {
      const result = fn();
      if (result != null && typeof (result as { then?: unknown }).then === 'function') {
        (result as Promise<unknown>).then(undefined, (err) => logFaultOnce(where, err));
      }
    } catch (err) {
      logFaultOnce(where, err);
    }
    const elapsed = Date.now() - start;
    if (elapsed > BUDGET_MS) {
      logFaultOnce(where, new Error(`exceeded ${BUDGET_MS}ms best-effort budget (${elapsed}ms)`));
    }
  };

  return {
    emit(name, props = {}) {
      safe('emit', () => {
        const redacted = redact(props) as Record<string, unknown>; // Req 5.4 (PII boundary)
        if (containsDeniedField(redacted)) {
          // Req 5.7: residual denied field after redaction ⇒ suppress emission and
          // record a redaction-failure indication. Name the event only — never a value.
          console.warn(`[telemetry] suppressed event "${name}": residual denied field after redaction`);
          return;
        }
        if (!neutralityGuard({ name, props: redacted }).pass) return; // Req 6.6 (withhold)
        return deps.posthog?.capture({ event: name, properties: redacted }); // return so safe() can attach its no-await rejection handler (Req 3.5/9.7/11.7)
      });
    },
    capture(error, context = {}) {
      safe('capture', () => deps.sentry?.captureException(error, redact(context))); // Req 4.4, 5.4
    },
  };
}

// --- Vendor SDK init — the ONLY place @sentry/node / posthog-node are constructed.
// compose.ts calls these to build `deps` for makeActiveTelemetry (Req 1.5).

// Initialize Sentry once with the configured DSN and sendDefaultPii: false (so the SDK
// never attaches request bodies / user data on its own — our Redactor is the boundary).
export function initSentry(dsn: string): SentryBackend {
  Sentry.init({ dsn, sendDefaultPii: false });
  return {
    captureException(error, context) {
      // Structured context rides as `extra` (already redacted by the port before this).
      Sentry.captureException(error, context ? { extra: context as Record<string, unknown> } : undefined);
    },
  };
}

// Initialize PostHog once with the configured key. We never emit a user identifier
// (Req 9.5, 8.7), so every server-side event uses a fixed anonymous distinct id.
export function initPosthog(key: string): PostHogBackend {
  const client = new PostHog(key);
  return {
    capture({ event, properties }) {
      client.capture({ distinctId: 'server', event, properties });
    },
  };
}

// ponytail: one runnable self-check (run `node --import tsx src/infra/telemetry/active.ts`).
// Uses STUB backends — zero outbound, no real SDK init. Full property/example coverage is
// tasks 5.2/5.5; this fails fast if the three load-bearing fail-open guarantees regress.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  // 1) A throwing stub backend does not propagate (fail-open, Req 3.5/9.7/11.7).
  const throwing = makeActiveTelemetry({
    sentry: { captureException() { throw new Error('sentry down'); } },
    posthog: { capture() { throw new Error('posthog down'); } },
  });
  throwing.emit('pipeline_complete', { reportId: 'r1', durationMs: 12 }); // must not throw
  throwing.capture(new Error('boom'), { reportId: 'r1', stage: 'extraction' }); // must not throw

  // 2) PII boundary: a denied field (jwt) never reaches the backend (Req 5.4).
  let captured: { event: string; properties: Record<string, unknown> } | undefined;
  const recording = makeActiveTelemetry({ posthog: { capture: (a) => { captured = a; } } });
  recording.emit('cache_hit', { submissionId: 's1', jwt: 'a.b.c', cached: true });
  assert.ok(captured, 'a clean event should reach posthog');
  assert.equal('jwt' in captured!.properties, false); // denied key stripped before emission
  assert.equal(captured!.properties.submissionId, 's1'); // non-denied field preserved

  // 3) A neutrality-failing event is withheld — posthog is never called (Req 6.6).
  let withheld: unknown;
  const guarded = makeActiveTelemetry({ posthog: { capture: (a) => { withheld = a; } } });
  guarded.emit('view', { reportId: 'r1', creatorReliability: 0.9 });
  assert.equal(withheld, undefined, 'a creator-reliability event must be withheld');

  // 4) Absent concern ⇒ that method is a no-op (no posthog ⇒ emit no-ops; no sentry ⇒ capture no-ops).
  const empty = makeActiveTelemetry({});
  empty.emit('cache_miss', { submissionId: 's2' }); // must not throw
  empty.capture(new Error('x'), {}); // must not throw

  console.log('active.ts self-check passed');
}
