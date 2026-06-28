// Feature: observability-instrumentation — call-site example test (task 6.5).
// Validates: Requirements 4.1, 4.2, 4.5, 4.8, 8.2, 8.7, 9.1, 9.2, 9.3, 9.4
//
// Drives the real call sites with a RECORDING Telemetry stub (no vendor SDK, zero
// outbound) and asserts each emits/captures exactly what the design promises, while
// the product behavior around it is unchanged:
//   - routes: a cache hit emits `cache_hit` (submissionId + cached:true); a queued
//     miss emits `cache_miss` (submissionId); a dispute emits `{reportId, claimId}`;
//     a flag emits `{reportId}` only (no claimId, no user id) (9.1, 9.4, 8.2, 8.7);
//   - worker: a completed run emits one `pipeline_complete` carrying status /
//     durationMs / outcomeDistribution / citationCoverage (9.2, 9.3);
//   - worker: a pipeline failure fires `capture` exactly once and the persisted
//     report is still `failed` with the same error message (4.2, 4.5);
//   - express error handler: a route error fires `capture` exactly once and the
//     HTTP status/body returned to the client are unchanged (4.1, 4.8).

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';

import { makeRouter } from '../src/http/routes';
import { makeWorker } from '../src/pipeline/worker';
import {
  InMemoryCache,
  InMemoryQueue,
  InMemoryRateLimiter,
  InMemoryRepository,
} from '../src/infra/memory';
import { cacheKey } from '../src/core/hash';
import {
  mockEvidence,
  mockLLM,
  mockNormalizer,
  mockPerspective,
  mockValidator,
  passthroughTranscript,
} from '../src/providers/mock';
import type { Providers, Transcript } from '../src/providers/types';
import type { Job, Telemetry } from '../src/infra/ports';
import type { AnalysisReport, FramingSignal, RawInput } from '../src/types';

// --- recording Telemetry stub: captures every call without any outbound emission. ---
interface EmitCall {
  name: string;
  props?: Record<string, unknown>;
}
interface CaptureCall {
  err: unknown;
  ctx?: Record<string, unknown>;
}
function recordingTelemetry(): { telemetry: Telemetry; emits: EmitCall[]; captures: CaptureCall[] } {
  const emits: EmitCall[] = [];
  const captures: CaptureCall[] = [];
  const telemetry: Telemetry = {
    emit: (name, props) => {
      emits.push({ name, props });
    },
    capture: (err, ctx) => {
      captures.push({ err, ctx });
    },
  };
  return { telemetry, emits, captures };
}

const providers: Providers = {
  transcript: passthroughTranscript,
  llm: mockLLM,
  evidence: mockEvidence,
  perspective: mockPerspective,
  normalizer: mockNormalizer,
  validator: mockValidator,
};

const meta = { model: 'mock', analysisVersion: 'test', sourcePolicyVersion: 'test' };

function readyReport(id: string, overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  const now = new Date().toISOString();
  return {
    id,
    contentId: 'content-1',
    urlHash: 'hash-1',
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    claims: [],
    framingSignals: [],
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function startApp(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// =========================================================================== //
// Routes — cache hit / miss
// =========================================================================== //

test('routes: cache hit emits cache_hit and a queued miss emits cache_miss', async () => {
  const { telemetry, emits } = recordingTelemetry();
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const queue = new InMemoryQueue();
  const limiter = new InMemoryRateLimiter(1000);

  // Seed the cache for the HIT input so the submit short-circuits to the cached report.
  const hitInput: RawInput = { sourceType: 'transcript', transcript: 'a cached transcript.' };
  const hitHash = cacheKey(hitInput);
  await cache.set(hitHash, readyReport('cached-report', { urlHash: hitHash }));

  const app = express()
    .use(express.json())
    .use('/api/v1', makeRouter({ repo, cache, queue, limiter, telemetry }));
  const { url, close } = await startApp(app);

  try {
    // 9.1 — cache hit: serve the existing report, emit cache_hit with submissionId + label.
    const hitRes = await fetch(`${url}/api/v1/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(hitInput),
    });
    assert.equal(hitRes.status, 200);
    assert.deepEqual(await hitRes.json(), { reportId: 'cached-report', status: 'ready', cached: true });

    // 9.1 — cache miss: queue a new analysis, emit cache_miss with submissionId.
    const missInput: RawInput = { sourceType: 'transcript', transcript: 'a brand new transcript.' };
    const missHash = cacheKey(missInput);
    const missRes = await fetch(`${url}/api/v1/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(missInput),
    });
    assert.equal(missRes.status, 202);

    const hit = emits.find((e) => e.name === 'cache_hit');
    const miss = emits.find((e) => e.name === 'cache_miss');
    assert.ok(hit, 'cache hit must emit a cache_hit event');
    assert.deepEqual(hit!.props, { submissionId: hitHash, cached: true });
    assert.ok(miss, 'a queued miss must emit a cache_miss event');
    assert.deepEqual(miss!.props, { submissionId: missHash });

    // No user id is ever present on either operator event (9.5 / 8.7).
    for (const e of [hit!, miss!]) {
      assert.ok(!('userId' in (e.props ?? {})), 'operator events carry no user id');
    }
  } finally {
    await close();
  }
});

// =========================================================================== //
// Routes — dispute / flag
// =========================================================================== //

test('routes: dispute emits {reportId, claimId}; flag emits {reportId} only (no user id)', async () => {
  const { telemetry, emits } = recordingTelemetry();
  const repo = new InMemoryRepository();
  const reportId = 'report-under-test';
  await repo.saveReport(
    readyReport(reportId, {
      framingSignals: [
        {
          technique: 'Emotional Language',
          severity: 'medium',
          description: 'high-arousal wording.',
          examples: [{ text: 'shocking!', explanation: 'charged phrasing', startIndex: 0, endIndex: 9 }],
        } as FramingSignal,
      ],
    }),
  );

  // Stub auth so requireAuth on the flag route passes (mirrors flag.persist.test.ts).
  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.user = { id: 'user-1', email: 'u@x.test', role: 'authenticated' };
    next();
  };

  const app = express()
    .use(express.json())
    .use(
      '/api/v1',
      authStub,
      makeRouter({
        repo,
        cache: new InMemoryCache(),
        queue: new InMemoryQueue(),
        limiter: new InMemoryRateLimiter(1000),
        telemetry,
      }),
    );
  const { url, close } = await startApp(app);

  try {
    // 9.4 / 8.2 / 8.7 — dispute: event references report + claim id only.
    const dRes = await fetch(`${url}/api/v1/analyses/${reportId}/disputes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'this is wrong', claimId: 'claim-7' }),
    });
    assert.equal(dRes.status, 201);

    // 9.4 / 8.7 — flag: event references the report id only, never the user id.
    const fRes = await fetch(`${url}/api/v1/analyses/${reportId}/flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ technique: 'Emotional Language' }),
    });
    assert.equal(fRes.status, 201);

    const dispute = emits.find((e) => e.name === 'dispute');
    const flag = emits.find((e) => e.name === 'flag');
    assert.ok(dispute, 'a created dispute must emit a dispute event');
    assert.deepEqual(dispute!.props, { reportId, claimId: 'claim-7' });

    assert.ok(flag, 'a created flag must emit a flag event');
    assert.deepEqual(flag!.props, { reportId });
    // 8.7 — the flag event carries the report id only: no claimId, no user identity.
    assert.ok(!('claimId' in (flag!.props ?? {})), 'flag event must not carry a claimId');
    assert.ok(!('userId' in (flag!.props ?? {})), 'flag event must not carry a user id');
  } finally {
    await close();
  }
});

// =========================================================================== //
// Worker — pipeline_complete on a successful run
// =========================================================================== //

test('worker: a completed run emits one pipeline_complete with status/durationMs/distribution/coverage', async () => {
  const { telemetry, emits, captures } = recordingTelemetry();
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const reportId = 'report-complete-1';
  const now = new Date().toISOString();
  await repo.saveReport(readyReport(reportId, { status: 'queued', tldr: '' }));

  const input: RawInput = {
    sourceType: 'transcript',
    transcript: 'A study found that 50 percent of people agree with the data.',
  };
  const job: Job = { reportId, contentId: 'content-1', urlHash: 'hash-1', input };

  const handleJob = makeWorker({ repo, cache, telemetry, providers, meta });
  await handleJob(job);

  // Exactly one pipeline_complete, no capture on a clean run.
  const completes = emits.filter((e) => e.name === 'pipeline_complete');
  assert.equal(completes.length, 1, 'exactly one pipeline_complete per completed run');
  assert.equal(captures.length, 0, 'a clean run captures no error');

  const finished = await repo.getReport(reportId);
  const props = completes[0]!.props!;
  // 9.2 — report id + resulting status label + non-negative integer ms duration.
  assert.equal(props.reportId, reportId);
  assert.equal(props.status, finished!.status);
  assert.equal(typeof props.durationMs, 'number');
  assert.ok(Number.isInteger(props.durationMs as number) && (props.durationMs as number) >= 0);

  // 9.3 — one non-negative integer count per defined Evidence_Outcome.
  const dist = props.outcomeDistribution as Record<string, number>;
  const OUTCOMES = [
    'matched_fact_check',
    'matched_primary_source',
    'matched_institutional_source',
    'relevant_context_only',
    'no_sufficient_evidence',
    'not_fact_checkable',
  ];
  for (const o of OUTCOMES) {
    assert.equal(typeof dist[o], 'number', `distribution carries ${o}`);
    assert.ok(Number.isInteger(dist[o]) && dist[o]! >= 0);
  }

  // 9.3 — citation coverage is a ratio in [0,1].
  const coverage = props.citationCoverage as number;
  assert.equal(typeof coverage, 'number');
  assert.ok(coverage >= 0 && coverage <= 1);
  // Distribution counts agree with the audit-derived coverage denominator.
  const definedTotal = OUTCOMES.reduce((sum, o) => sum + dist[o]!, 0);
  assert.equal(finished!.claims.length, definedTotal, 'distribution totals the verified claims');
});

// =========================================================================== //
// Worker — capture exactly once on a pipeline failure, persisted `failed` unchanged
// =========================================================================== //

test('worker: a pipeline failure captures exactly once and still persists failed with the same error', async () => {
  const { telemetry, emits, captures } = recordingTelemetry();
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const reportId = 'report-fail-1';
  await repo.saveReport(readyReport(reportId, { status: 'queued', tldr: '' }));

  const BOOM = 'extraction blew up';
  const throwingProviders: Providers = {
    ...providers,
    llm: {
      async extract(): Promise<never> {
        throw new Error(BOOM);
      },
    },
  };

  const input: RawInput = { sourceType: 'transcript', transcript: 'anything at all.' };
  const job: Job = { reportId, contentId: 'content-1', urlHash: 'hash-1', input };

  const handleJob = makeWorker({ repo, cache, telemetry, providers: throwingProviders, meta });
  await handleJob(job);

  // 4.2 — captured exactly once, with structured context naming the report id.
  assert.equal(captures.length, 1, 'a pipeline failure captures exactly once');
  assert.equal((captures[0]!.err as Error).message, BOOM);
  assert.equal(captures[0]!.ctx?.reportId, reportId);
  // No pipeline_complete on a failed run (the emit is after a successful return).
  assert.equal(emits.filter((e) => e.name === 'pipeline_complete').length, 0);

  // 4.5 — the existing failed-status persistence is unchanged by the capture.
  const finished = await repo.getReport(reportId);
  assert.ok(finished);
  assert.equal(finished!.status, 'failed');
  assert.equal(finished!.error, BOOM);
});

// =========================================================================== //
// Express error handler — capture once, HTTP status/body unchanged
// =========================================================================== //

test('express error handler: a route error captures once and returns the unchanged 500 body', async () => {
  const { telemetry, captures } = recordingTelemetry();

  // A repo whose getReport rejects, so the GET /analyses/:id handler forwards the
  // rejection to the Express error handler (Express 5 auto-forwards async rejections).
  class ThrowingRepo extends InMemoryRepository {
    async getReport(): Promise<AnalysisReport | undefined> {
      throw new Error('repo exploded');
    }
  }

  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1',
    makeRouter({
      repo: new ThrowingRepo(),
      cache: new InMemoryCache(),
      queue: new InMemoryQueue(),
      limiter: new InMemoryRateLimiter(1000),
      telemetry,
    }),
  );
  // Mirror the index.ts error handler exactly: console.error, capture once, then the
  // unchanged 500 status + { error: 'internal_error' } body (Req 4.1, 4.8).
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error('[error]', err);
    telemetry.capture(err, { source: 'express_error_handler', method: req.method, path: req.path });
    res.status(500).json({ error: 'internal_error' });
  });

  const { url, close } = await startApp(app);
  try {
    const res = await fetch(`${url}/api/v1/analyses/anything`);
    // 4.8 — identical HTTP status code and response body the client sees today.
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'internal_error' });
    // 4.1 — captured exactly once, in addition to the console.error logging.
    assert.equal(captures.length, 1, 'the error handler captures exactly once');
    assert.equal((captures[0]!.err as Error).message, 'repo exploded');
  } finally {
    await close();
  }
});
