// Feature: intervention-and-scale, task 12.4 — validation/edge tests for the
// authenticated POST /api/v1/coaching route.
// Validates: Requirements 10.5, 10.6, 10.7, 10.8, 11.7, 12.1
//
// Drives the REAL route handler (makeRouter + InMemory infra over an ephemeral
// HTTP server) end to end. The coaching route order is load-bearing:
//   requireAuth → coachingBodySchema (draft trimmed 1..50000) → coaching trust
//   gate (503 dark) → per-user rolling limiter 10/60s (429) → coachingLLM-missing
//   (500) → analyzeDraft under a 30s budget (timeout/throw → 500) → sendNeutral 200.
//
// The four observable behaviours asserted here:
//   1. 401 without a token — requireAuth rejects before the engine is invoked (Req 10.6).
//   2. 400 invalid drafts (empty / whitespace-only / >50000 chars) — the zod
//      boundary rejects and the engine is NOT invoked (Req 10.5).
//   3. 429 once 10 requests land in the rolling 60s window for the same user, with a
//      whole-second Retry-After header on the 11th (Req 10.8).
//   4. 500 coaching_unavailable on an internal failure during analysis, with nothing
//      persisted (Req 10.7, 11.7).
//
// Analyze-error semantics (subtle — read before changing case 4):
//   analyzeDraft (core/coaching.ts) is TOTAL: it catches any LLM/parse error and
//   degrades to an honest empty response, so a *rejecting* LLM yields a 200 with
//   noIssues, NOT a 500 — the route's catch→500 fires only on the 30s timeout
//   (impractical to drive in a unit test). The reachable, deterministic internal
//   error that DOES produce 500 coaching_unavailable is the gate-satisfied-but-
//   coachingLLM-missing path (Req 11.7), which we assert directly. We additionally
//   pin the graceful-degradation behaviour (rejecting LLM → 200 honest-empty, no
//   persistence) so the route's flaky-provider handling is covered.
//
// Gate strategy mirrors intervention.graphql.route.test.ts: config.trustThresholds
// is a live getter over process.env, so TRUST_COACH_* toggles the real coaching
// gate every request. We subclass InMemoryRepository to synthesize one agreeing
// expert-review Human_Signal sharing a (reportId, claimId) with a seeded
// matched_fact_check Evidence_Outcome ⇒ coverage 1.0, agreement 1.0; with the env
// mins at 0 and TRUST_COACH_LEGAL_OK=true the gate is satisfied. For the 401/400
// cases the gate never matters (auth and validation both precede it).

// Set the coaching trust-gate env BEFORE importing config (read live by its getter anyway).
process.env.TRUST_COACH_COVERAGE_MIN = '0';
process.env.TRUST_COACH_AGREEMENT_MIN = '0';

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

const { makeRouter } = await import('../src/http/routes');
const { InMemoryCache, InMemoryQueue, InMemoryRateLimiter, InMemoryRepository } = await import(
  '../src/infra/memory'
);
const { noopTelemetry } = await import('../src/infra/telemetry/noop');
import type { AuditRecord, EvidenceOutcome } from '../src/types';
import type { HumanSignal } from '../src/core/kpi';
import type { LLMProvider } from '../src/core/coaching';
import type {
  InMemoryRepository as InMemoryRepositoryT,
  InMemoryCache as InMemoryCacheT,
} from '../src/infra/memory';

// --- gate helpers (mirror intervention.graphql.route.test.ts) --------------

const GATE_REPORT_ID = 'gate-r';
const GATE_CLAIM_ID = 'gate-c';

class GateSatisfyingRepo extends InMemoryRepository {
  async listHumanSignals(): Promise<HumanSignal[]> {
    return [
      {
        kind: 'expert_review',
        reportId: GATE_REPORT_ID,
        claimId: GATE_CLAIM_ID,
        reviewStatus: 'expert-reviewed',
      },
    ];
  }
}

function makeAudit(claimId: string, evidenceOutcome: EvidenceOutcome): AuditRecord {
  return {
    claimId,
    originalClaim: 'o',
    canonicalClaim: 'c',
    claimType: 'factual_event',
    factCheckability: 'checkable',
    queryPack: [],
    candidates: [],
    evidenceOutcome,
    evidenceStrength: 'none',
    prototypeVocab: 'insufficient',
    createdAt: new Date().toISOString(),
  };
}

async function gateSatisfyingRepo(): Promise<InstanceType<typeof GateSatisfyingRepo>> {
  const repo = new GateSatisfyingRepo();
  // Seed only an audit record so coverage = 1.0 and agreement = 1.0; no report
  // rows are written, so the persisted corpus stays empty (used to prove the
  // coaching path persists nothing).
  await repo.saveAuditRecord(GATE_REPORT_ID, makeAudit(GATE_CLAIM_ID, 'matched_fact_check'));
  return repo;
}

// --- LLM stubs -------------------------------------------------------------

// A counting LLM that returns "no issues". calls lets us assert the engine was
// (not) invoked. Returns '[]' so analyzeDraft yields { issues: [], noIssues: true }.
function countingLLM(): LLMProvider & { calls: number } {
  return {
    calls: 0,
    async analyze() {
      this.calls += 1;
      return '[]';
    },
  };
}

// An LLM that always rejects — analyzeDraft swallows it and degrades to empty.
function rejectingLLM(): LLMProvider & { calls: number } {
  return {
    calls: 0,
    async analyze() {
      this.calls += 1;
      throw new Error('llm boom');
    },
  };
}

// --- HTTP harness (mirrors sibling *.route.test.ts files) ------------------

// Build the app. When `userId` is provided, a tiny stub middleware sets req.user
// (mirrors savedReports.routes / workspace.routes) so requireAuth passes; omit it
// to exercise the real 401 (no user). `coachingLLM` is optional so the missing-LLM
// 500 path can be exercised.
function buildApp(
  repo: InMemoryRepositoryT,
  cache: InMemoryCacheT,
  opts: { userId?: string; coachingLLM?: LLMProvider } = {},
) {
  const queue = new InMemoryQueue();
  const limiter = new InMemoryRateLimiter(1000);
  const app = express().use(express.json());
  if (opts.userId) {
    const uid = opts.userId;
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: uid, role: 'authenticated' };
      next();
    });
  }
  app.use(
    '/api/v1',
    makeRouter({ repo, cache, queue, limiter, telemetry: noopTelemetry, coachingLLM: opts.coachingLLM }),
  );
  return app;
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

async function postCoaching(
  base: string,
  body: unknown,
): Promise<{ status: number; retryAfter: string | null; json: Record<string, unknown> }> {
  const res = await fetch(`${base}/api/v1/coaching`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    retryAfter: res.headers.get('retry-after'),
    json: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

const VALID_DRAFT = 'Unemployment fell sharply last quarter, which is great news for everyone.';

// =========================================================================== //

test('401: no token ⇒ requireAuth rejects and the engine is not invoked (Req 10.6)', async () => {
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const llm = countingLLM();
  // No userId ⇒ req.user unset ⇒ requireAuth 401 before validation/gate/engine.
  const { url, close } = await startApp(buildApp(repo, cache, { coachingLLM: llm }));
  try {
    const res = await postCoaching(url, { draft: VALID_DRAFT });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'auth_required');
    assert.equal(llm.calls, 0, 'the coaching engine must not run for an unauthenticated caller');
  } finally {
    await close();
  }
});

test('400: empty / whitespace-only / >50000-char drafts ⇒ invalid_input, engine not invoked (Req 10.5)', async () => {
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const llm = countingLLM();
  // Authenticated so we pass requireAuth and reach the zod boundary. The gate is
  // left dark (default) — irrelevant, because validation precedes the gate.
  const { url, close } = await startApp(buildApp(repo, cache, { userId: 'u-400', coachingLLM: llm }));
  try {
    for (const draft of ['', '   \t\n  ', 'a'.repeat(50001)]) {
      const res = await postCoaching(url, { draft });
      assert.equal(res.status, 400, `draft of length ${draft.length} should be 400`);
      assert.equal(res.json.error, 'invalid_input');
    }
    // A body missing the field entirely is also rejected at the boundary.
    const missing = await postCoaching(url, {});
    assert.equal(missing.status, 400);
    assert.equal(missing.json.error, 'invalid_input');

    assert.equal(llm.calls, 0, 'the coaching engine must not run for invalid input');
  } finally {
    await close();
  }
});

test('429: >10 coaching requests for the same user in 60s ⇒ rate_limited with Retry-After (Req 10.8)', async () => {
  process.env.TRUST_COACH_LEGAL_OK = 'true';
  try {
    const repo = await gateSatisfyingRepo();
    const cache = new InMemoryCache();
    const llm = countingLLM();
    // Unique user id: the coaching limiter is a module-level Map keyed by
    // user:<id> that lives for the process, so a fresh id avoids cross-test bleed.
    const userId = `u-429-${randomUUID()}`;
    const { url, close } = await startApp(buildApp(repo, cache, { userId, coachingLLM: llm }));
    try {
      // First 10 are inside the window ⇒ allowed (gate satisfied, LLM returns []).
      for (let i = 0; i < 10; i += 1) {
        const res = await postCoaching(url, { draft: VALID_DRAFT });
        assert.equal(res.status, 200, `request ${i + 1} should be allowed`);
      }
      // The 11th exceeds 10/60s ⇒ 429 with a whole-second Retry-After.
      const limited = await postCoaching(url, { draft: VALID_DRAFT });
      assert.equal(limited.status, 429);
      assert.equal(limited.json.error, 'rate_limited');
      assert.ok(limited.retryAfter, 'a Retry-After header must be present on the 429');
      const secs = Number(limited.retryAfter);
      assert.ok(Number.isInteger(secs) && secs >= 1, `Retry-After must be a whole second >= 1, got ${limited.retryAfter}`);
    } finally {
      await close();
    }
  } finally {
    delete process.env.TRUST_COACH_LEGAL_OK;
  }
});

test('500: gate satisfied but coachingLLM unwired ⇒ coaching_unavailable, nothing persisted (Req 11.7)', async () => {
  process.env.TRUST_COACH_LEGAL_OK = 'true';
  try {
    const repo = await gateSatisfyingRepo();
    const cache = new InMemoryCache();
    const reportsBefore = repo.reports.size;
    // Authenticated + gate satisfied, but no coachingLLM ⇒ the route hits the
    // internal-error 500 (Req 11.7) rather than invoking a missing dependency.
    const { url, close } = await startApp(buildApp(repo, cache, { userId: `u-500-${randomUUID()}` }));
    try {
      const res = await postCoaching(url, { draft: VALID_DRAFT });
      assert.equal(res.status, 500);
      assert.equal(res.json.error, 'coaching_unavailable');
      // The coaching path never persists — no report rows appeared (Req 11.7, 13.5).
      assert.equal(repo.reports.size, reportsBefore);
      assert.equal(repo.reports.size, 0);
    } finally {
      await close();
    }
  } finally {
    delete process.env.TRUST_COACH_LEGAL_OK;
  }
});

test('analyze failure degrades to an honest empty 200 and persists nothing (Req 10.7 / 11.7 catch path)', async () => {
  // analyzeDraft is total: a rejecting LLM is swallowed and degrades to noIssues,
  // so this yields 200 (not 500) — the catch→500 fires only on the 30s timeout,
  // which shares the same handler but is impractical to drive in a unit test. We
  // pin the graceful behaviour and confirm nothing is persisted on a flaky LLM.
  process.env.TRUST_COACH_LEGAL_OK = 'true';
  try {
    const repo = await gateSatisfyingRepo();
    const cache = new InMemoryCache();
    const llm = rejectingLLM();
    const { url, close } = await startApp(buildApp(repo, cache, { userId: `u-deg-${randomUUID()}`, coachingLLM: llm }));
    try {
      const res = await postCoaching(url, { draft: VALID_DRAFT });
      assert.equal(res.status, 200);
      assert.equal(res.json.noIssues, true);
      assert.deepEqual(res.json.issues, []);
      assert.equal(llm.calls, 1, 'the engine was invoked exactly once');
      assert.equal(repo.reports.size, 0, 'no report was persisted by the coaching path');
    } finally {
      await close();
    }
  } finally {
    delete process.env.TRUST_COACH_LEGAL_OK;
  }
});
