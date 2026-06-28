// Feature: observability-instrumentation, Property 7: Active telemetry is fail-open.
// Validates: Requirements 3.5, 9.7, 11.7
//
// For any call payload, when the underlying backend throws synchronously OR rejects a
// promise on every emit/capture, the active Telemetry_Port contains the fault and
// returns without throwing, never propagating it to the caller. `capture` always
// reaches its backend (no neutrality gate), and `emit` is fed clean, neutral props so
// it reaches posthog — so the throwing/rejecting backend is genuinely exercised on
// every run, and we additionally assert the backend was actually invoked.
//
// Plus one non-PBT example: the safe() ≤50 ms best-effort budget abandons a
// deliberately slow stub — async work is never awaited (a never-resolving promise
// returns immediately) and a synchronous overrun is logged but the call still returns.

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { makeActiveTelemetry } from '../src/infra/telemetry/active';

// A single emit or capture invocation. emit props use known-clean, neutral keys so the
// payload survives redaction + the Neutrality_Guard and reaches the (faulting) backend.
const SAFE_KEY = fc.constantFrom('reportId', 'submissionId', 'status', 'durationMs', 'count', 'stage');
const primitive = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.double({ noNaN: true }));

const operation = fc.oneof(
  fc.record({
    kind: fc.constant<'emit'>('emit'),
    name: fc.constantFrom('pipeline_complete', 'cache_hit', 'cache_miss', 'dispute', 'flag'),
    props: fc.dictionary(SAFE_KEY, primitive),
  }),
  fc.record({
    kind: fc.constant<'capture'>('capture'),
    error: fc.anything(),
    context: fc.dictionary(SAFE_KEY, primitive),
  }),
);

// How the backend fails: throw synchronously, or return a rejected promise.
const faultMode = fc.constantFrom<'throw' | 'reject'>('throw', 'reject');

test('Property 7: a throwing/rejecting backend never propagates out of emit/capture', async () => {
  fc.assert(
    fc.property(operation, faultMode, (op, mode) => {
      let invoked = 0;
      const boom = () => {
        invoked += 1;
        if (mode === 'throw') throw new Error('backend down');
        return Promise.reject(new Error('backend rejected'));
      };
      const telemetry = makeActiveTelemetry({
        sentry: { captureException: boom },
        posthog: { capture: boom },
      });

      // The call MUST return without throwing (fail-open).
      let returned: unknown = 'sentinel';
      assert.doesNotThrow(() => {
        returned = op.kind === 'emit' ? telemetry.emit(op.name, op.props) : telemetry.capture(op.error, op.context);
      });
      // The port methods are synchronous void — nothing awaitable comes back.
      assert.equal(returned, undefined);
      // The fault was genuinely exercised: the backend was actually invoked once.
      assert.equal(invoked, 1, 'the faulting backend should be reached exactly once');
    }),
    { numRuns: 200 },
  );
  // The faulting backends return already-rejected promises; safe() attaches a rejection
  // handler (no await) so they never propagate, but the handler fires as a microtask.
  // Flush the microtask/timer queue so that trailing activity settles before the test
  // ends (node:test flags async work that outlives the test body).
  await new Promise((resolve) => setImmediate(resolve));
});

test('Property 7 (example): safe() ≤50 ms budget abandons a slow stub without blocking', () => {
  // (a) async-never-awaited: a backend returning a promise that never settles must not
  // make the call hang — safe() attaches a rejection handler but never awaits, so the
  // call returns within the same synchronous tick. If it awaited, this test would hang.
  const neverSettles = makeActiveTelemetry({
    sentry: { captureException: () => new Promise(() => {}) },
    posthog: { capture: () => new Promise(() => {}) },
  });
  const start = Date.now();
  assert.doesNotThrow(() => neverSettles.capture(new Error('x'), { reportId: 'r1' }));
  assert.doesNotThrow(() => neverSettles.emit('pipeline_complete', { reportId: 'r1', durationMs: 5 }));
  // Returned promptly (well under a hang) — proves the call never blocked on the promise.
  assert.ok(Date.now() - start < 1000, 'never-settling async backend must not block the caller');

  // (b) synchronous overrun: a backend that busy-waits past the 50 ms best-effort budget
  // is logged but the call still returns without throwing (JS can't preempt sync work).
  const busyWaitPastBudget = () => {
    const end = Date.now() + 80; // > BUDGET_MS (50)
    while (Date.now() < end) {
      /* deliberate sync overrun */
    }
  };
  const slow = makeActiveTelemetry({
    sentry: { captureException: busyWaitPastBudget },
    posthog: { capture: busyWaitPastBudget },
  });
  assert.doesNotThrow(() => slow.capture(new Error('x'), { reportId: 'r1' }));
  assert.doesNotThrow(() => slow.emit('cache_hit', { submissionId: 's1' }));
});
