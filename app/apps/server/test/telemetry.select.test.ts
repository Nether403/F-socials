// Feature: observability-instrumentation — selection example test (task 5.4).
// Validates: Requirements 1.2, 1.3, 1.4, 1.6, 1.7, 2.5, 2.7, 3.2, 3.6, 10.3, 10.5
//
// Exercises selectTelemetry() — the composition-root selection function that mirrors
// selectRepo/selectCache. Because the real config is read once at module init and the
// vendor-SDK init helpers (initSentry/initPosthog) touch @sentry/node / posthog-node,
// selectTelemetry accepts optional overrides ONLY for testing: injected config values
// and stub init helpers, so these examples never perform real SDK init or outbound I/O.
// The production call `selectTelemetry()` (in buildContext) is unchanged in behaviour.
//
// Examples covered:
//   - each selection branch (both / neither / exactly-one configured) resolves the
//     right impl (active backends vs the shared frozen noopTelemetry singleton);
//   - init-failure falls back to no-op (warns "telemetry initialization failure");
//   - exactly one [infra] startup log names the selected backend (or no-op);
//   - a warning names skipped / absent backends (SENTRY_DSN / POSTHOG_KEY);
//   - identical env ⇒ identical selection in both processes (determinism).

import test from 'node:test';
import assert from 'node:assert/strict';

import { selectTelemetry, type SelectTelemetryOverrides } from '../src/compose';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import type { SentryBackend, PostHogBackend } from '../src/infra/telemetry/active';

// --- console spy: capture [infra] startup logs + warnings, restore afterwards. ---
interface Spy {
  logs: string[];
  warns: string[];
  restore(): void;
}
function spyConsole(): Spy {
  const origLog = console.log;
  const origWarn = console.warn;
  const logs: string[] = [];
  const warns: string[] = [];
  console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
  console.warn = (...a: unknown[]) => { warns.push(a.join(' ')); };
  return { logs, warns, restore() { console.log = origLog; console.warn = origWarn; } };
}

// Stub init helpers that record invocation and return a recording backend, so we can
// (a) assert which backend was constructed and (b) verify emit→posthog / capture→sentry
// routing of the selected impl — all without touching a real vendor SDK.
function stubDeps() {
  const sentryCalls: string[] = []; // dsn values passed to initSentry
  const posthogCalls: string[] = []; // key values passed to initPosthog
  const sentryCaptured: unknown[] = [];
  const posthogCaptured: { event: string; properties: Record<string, unknown> }[] = [];

  const initSentry = (dsn: string): SentryBackend => {
    sentryCalls.push(dsn);
    return { captureException: (e) => { sentryCaptured.push(e); } };
  };
  const initPosthog = (key: string): PostHogBackend => {
    posthogCalls.push(key);
    return { capture: (a) => { posthogCaptured.push(a); } };
  };
  return { initSentry, initPosthog, sentryCalls, posthogCalls, sentryCaptured, posthogCaptured };
}

// --- 1.4 / 3.1 / 3.2: neither configured ⇒ the shared frozen noopTelemetry singleton,
// exactly one [infra] log naming `no-op`, warnings naming BOTH absent variables. ---
test('selection: neither configured ⇒ shared no-op singleton, one log, both absent warned', () => {
  const spy = spyConsole();
  const deps = stubDeps();
  let result;
  try {
    result = selectTelemetry({ sentryDsn: '', posthogKey: '', ...injectInit(deps) });
  } finally {
    spy.restore();
  }

  // Right impl: the exact frozen no-op singleton (Req 1.4, 3.1).
  assert.equal(result, noopTelemetry, 'both unconfigured must return the shared noopTelemetry');
  // No vendor init attempted.
  assert.deepEqual(deps.sentryCalls, []);
  assert.deepEqual(deps.posthogCalls, []);
  // Exactly one [infra] startup log, naming no-op (Req 1.6).
  const infraLogs = spy.logs.filter((l) => l.includes('[infra] Telemetry:'));
  assert.equal(infraLogs.length, 1, `expected one [infra] Telemetry log, got: ${infraLogs.join(' | ')}`);
  assert.match(infraLogs[0]!, /no-op/);
  // Warning names BOTH absent variables (Req 1.7, 3.2, 3.6).
  const absentWarn = spy.warns.find((w) => w.includes('absent'));
  assert.ok(absentWarn, 'expected a warning naming the absent telemetry variables');
  assert.match(absentWarn!, /SENTRY_DSN/);
  assert.match(absentWarn!, /POSTHOG_KEY/);
});

// --- 1.3 / 1.6: both configured ⇒ active impl wiring BOTH backends; one log naming
// both; emit routes to posthog, capture routes to sentry. ---
test('selection: both configured ⇒ active impl wiring both backends, one log names both', () => {
  const spy = spyConsole();
  const deps = stubDeps();
  let result;
  try {
    result = selectTelemetry({ sentryDsn: 'https://k@sentry.example/1', posthogKey: 'phc_key', ...injectInit(deps) });
  } finally {
    spy.restore();
  }

  // Right impl: NOT the no-op singleton; both backends constructed (Req 1.3).
  assert.notEqual(result, noopTelemetry, 'a configured backend must produce an active impl');
  assert.deepEqual(deps.sentryCalls, ['https://k@sentry.example/1']);
  assert.deepEqual(deps.posthogCalls, ['phc_key']);
  // Routing of the selected impl: emit→posthog, capture→sentry.
  result.emit('pipeline_complete', { reportId: 'r1', durationMs: 12 });
  result.capture(new Error('boom'), { reportId: 'r1', stage: 'extraction' });
  assert.equal(deps.posthogCaptured.length, 1, 'emit should reach the PostHog backend');
  assert.equal(deps.posthogCaptured[0]!.event, 'pipeline_complete');
  assert.equal(deps.sentryCaptured.length, 1, 'capture should reach the Sentry backend');
  // Exactly one [infra] log naming BOTH selected backends (Req 1.6).
  const infraLogs = spy.logs.filter((l) => l.includes('[infra] Telemetry:'));
  assert.equal(infraLogs.length, 1, `expected one [infra] Telemetry log, got: ${infraLogs.join(' | ')}`);
  assert.match(infraLogs[0]!, /Sentry/);
  assert.match(infraLogs[0]!, /PostHog/);
  // No "absent" warning when both are configured.
  assert.equal(spy.warns.some((w) => w.includes('absent')), false);
});

// --- 3.6: exactly one configured (Sentry only) ⇒ only that backend active; the other
// degrades to no-op; a warning names the absent variable. ---
test('selection: exactly one (Sentry only) ⇒ only Error_Monitor active, POSTHOG_KEY warned', () => {
  const spy = spyConsole();
  const deps = stubDeps();
  let result;
  try {
    result = selectTelemetry({ sentryDsn: 'https://k@sentry.example/1', posthogKey: '', ...injectInit(deps) });
  } finally {
    spy.restore();
  }

  assert.notEqual(result, noopTelemetry);
  assert.deepEqual(deps.sentryCalls, ['https://k@sentry.example/1']);
  assert.deepEqual(deps.posthogCalls, [], 'PostHog must not be constructed when unconfigured');
  // capture reaches sentry; emit no-ops (no posthog backend) without throwing.
  result.emit('cache_miss', { submissionId: 's1' });
  result.capture(new Error('x'), { reportId: 'r1' });
  assert.equal(deps.posthogCaptured.length, 0, 'emit must no-op when Product_Analytics is unconfigured');
  assert.equal(deps.sentryCaptured.length, 1);
  // Log names only Sentry (Req 1.6); warning names the absent POSTHOG_KEY (Req 3.6).
  const infraLogs = spy.logs.filter((l) => l.includes('[infra] Telemetry:'));
  assert.equal(infraLogs.length, 1);
  assert.match(infraLogs[0]!, /Sentry/);
  assert.equal(infraLogs[0]!.includes('PostHog'), false);
  const absentWarn = spy.warns.find((w) => w.includes('absent'));
  assert.ok(absentWarn && absentWarn.includes('POSTHOG_KEY') && !absentWarn.includes('SENTRY_DSN'),
    `warning should name only POSTHOG_KEY, got: ${absentWarn}`);
});

// --- 3.6: exactly one configured (PostHog only) ⇒ symmetric to the above. ---
test('selection: exactly one (PostHog only) ⇒ only Product_Analytics active, SENTRY_DSN warned', () => {
  const spy = spyConsole();
  const deps = stubDeps();
  let result;
  try {
    result = selectTelemetry({ sentryDsn: '', posthogKey: 'phc_key', ...injectInit(deps) });
  } finally {
    spy.restore();
  }

  assert.notEqual(result, noopTelemetry);
  assert.deepEqual(deps.posthogCalls, ['phc_key']);
  assert.deepEqual(deps.sentryCalls, []);
  result.emit('cache_hit', { submissionId: 's1', cached: true });
  result.capture(new Error('x'), { reportId: 'r1' });
  assert.equal(deps.posthogCaptured.length, 1);
  assert.equal(deps.sentryCaptured.length, 0, 'capture must no-op when Error_Monitor is unconfigured');
  const infraLogs = spy.logs.filter((l) => l.includes('[infra] Telemetry:'));
  assert.equal(infraLogs.length, 1);
  assert.match(infraLogs[0]!, /PostHog/);
  assert.equal(infraLogs[0]!.includes('Sentry'), false);
  const absentWarn = spy.warns.find((w) => w.includes('absent'));
  assert.ok(absentWarn && absentWarn.includes('SENTRY_DSN') && !absentWarn.includes('POSTHOG_KEY'),
    `warning should name only SENTRY_DSN, got: ${absentWarn}`);
});

// --- 10.5: init-failure falls back to no-op, warning "telemetry initialization failure",
// without aborting. ---
test('selection: init failure ⇒ falls back to no-op with an init-failure warning', () => {
  const spy = spyConsole();
  let result;
  try {
    result = selectTelemetry({
      sentryDsn: 'https://k@sentry.example/1',
      posthogKey: 'phc_key',
      initSentry: () => { throw new Error('sentry init blew up'); },
      initPosthog: (): PostHogBackend => ({ capture() {} }),
    });
  } finally {
    spy.restore();
  }

  // Degrades to the shared no-op singleton rather than throwing (Req 10.5).
  assert.equal(result, noopTelemetry, 'an init failure must fall back to noopTelemetry');
  const failWarn = spy.warns.find((w) => w.includes('telemetry initialization failure'));
  assert.ok(failWarn, 'expected a "telemetry initialization failure" warning');
  assert.match(failWarn!, /sentry init blew up/);
});

// --- 2.7 / 10.3: identical env ⇒ identical selection in both processes (determinism).
// Two calls with the same inputs model the API and Worker reading the same shared config;
// they must resolve the identical selection. ---
test('selection: identical env ⇒ identical selection (no drift between processes)', () => {
  const spy = spyConsole();
  try {
    // (a) Both-unconfigured: both "processes" get the exact same frozen singleton.
    const a1 = selectTelemetry({ sentryDsn: '', posthogKey: '', ...injectInit(stubDeps()) });
    const a2 = selectTelemetry({ sentryDsn: '', posthogKey: '', ...injectInit(stubDeps()) });
    assert.equal(a1, noopTelemetry);
    assert.equal(a2, noopTelemetry);
    assert.equal(a1, a2, 'both processes must resolve the identical no-op singleton');

    // (b) Same configured env ⇒ identical backend selection in both calls.
    const d1 = stubDeps();
    const d2 = stubDeps();
    const env = { sentryDsn: 'https://k@sentry.example/1', posthogKey: 'phc_key' };
    selectTelemetry({ ...env, ...injectInit(d1) });
    selectTelemetry({ ...env, ...injectInit(d2) });
    assert.deepEqual(d1.sentryCalls, d2.sentryCalls, 'identical env ⇒ identical Error_Monitor selection');
    assert.deepEqual(d1.posthogCalls, d2.posthogCalls, 'identical env ⇒ identical Product_Analytics selection');

    // (c) Default (no overrides) reads the real shared config the same way each call —
    //     two reads of the one module = the two processes, identical selection.
    const r1 = selectTelemetry();
    const r2 = selectTelemetry();
    assert.equal(r1 === noopTelemetry, r2 === noopTelemetry, 'default selection must be identical across calls');
  } finally {
    spy.restore();
  }
});

// Helper: spread the stub init helpers into an overrides object.
function injectInit(deps: ReturnType<typeof stubDeps>): Pick<SelectTelemetryOverrides, 'initSentry' | 'initPosthog'> {
  return { initSentry: deps.initSentry, initPosthog: deps.initPosthog };
}
