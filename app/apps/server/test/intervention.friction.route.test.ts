// Feature: intervention-and-scale, task 5.4 — example/integration test for the
// public GET /api/v1/friction route.
// Validates: Requirements 1.4, 2.3, 5.1, 5.6
//
// Drives the REAL route handler (makeRouter + InMemory infra over an ephemeral
// HTTP server) end to end, asserting the four observable behaviours the route
// promises:
//   - 400 invalid_input when the required `url` query is missing (trust boundary).
//   - 503 capability_unavailable when the Feed_Friction trust gate is dark
//     (default config: legalReviewComplete=false), per-capability routing (Req 1.4).
//   - 404 not_found when the gate is satisfied but the url resolves to no content,
//     or to a report whose status !== 'ready' (Req 2.3).
//   - 200 lens-safe overlay { reportId, framingSignals, evidenceSummary, reportUrl }
//     with NO verdict and NO creator field when the gate is satisfied and a ready
//     report is cached under the route's content hash (Req 5.1, 5.6).
//
// Gate strategy — PREFER the real gate. config.trustThresholds is a live getter
// over process.env, so TRUST_FEED_* toggles the real Trust_Gate every request.
// The in-memory driver's listHumanSignals only models disputes (always a
// disagreement) so its live modelHumanAgreement can never exceed 0; to exercise
// the gate-satisfied path we subclass InMemoryRepository and synthesize one
// agreeing expert-review Human_Signal that shares a (reportId, claimId) with a
// seeded matched_fact_check Evidence_Outcome → coverage 1.0, agreement 1.0. The
// real metricsStore + real evaluateTrustGate + real route logic all run unchanged.

// Set the trust-gate env BEFORE importing config (read live by its getter anyway).
process.env.TRUST_FEED_COVERAGE_MIN = '0';
process.env.TRUST_FEED_AGREEMENT_MIN = '0';

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';

const { makeRouter } = await import('../src/http/routes');
const { InMemoryCache, InMemoryQueue, InMemoryRateLimiter, InMemoryRepository } = await import(
  '../src/infra/memory'
);
const { noopTelemetry } = await import('../src/infra/telemetry/noop');
const { cacheKey } = await import('../src/core/hash');
import type { AnalysisReport, AuditRecord, ContentItem, EvidenceOutcome } from '../src/types';
import type { HumanSignal } from '../src/core/kpi';
// Type-only handles for the dynamically-imported in-memory classes.
import type { InMemoryRepository as InMemoryRepositoryT, InMemoryCache as InMemoryCacheT } from '../src/infra/memory';

// --- gate helpers ----------------------------------------------------------

// A repo whose live metrics satisfy the gate: one matched_fact_check outcome
// (coverage 1.0) plus one agreeing expert-review signal on the same pair
// (agreement 1.0). Everything else is the real InMemoryRepository.
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
  // Seed the model outcome that pairs with the expert-review signal above so
  // citationCoverage = 1.0 (> min) and modelHumanAgreement = 1.0 (> min).
  await repo.saveAuditRecord(GATE_REPORT_ID, makeAudit(GATE_CLAIM_ID, 'matched_fact_check'));
  return repo;
}

// --- report / content fixtures --------------------------------------------

function readyReport(id: string, overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  const now = new Date().toISOString();
  return {
    id,
    contentId: 'content-1',
    urlHash: 'hash-1',
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    claims: [
      {
        id: 'claim-1',
        claimText: 'Unemployment fell last quarter.',
        verifiability: 'verifiable',
        evidenceStrength: 'moderate',
        confidence: 0.8,
        citations: [],
      },
    ],
    framingSignals: [
      {
        technique: 'Emotional Language',
        severity: 'high',
        description: 'Charged wording used to provoke a reaction.',
        examples: [
          { text: 'a catastrophic collapse', explanation: 'hyperbolic framing', startIndex: -1, endIndex: -1 },
        ],
      },
    ],
    contextCards: [],
    perspectives: [],
    shareSlug: 'share-abc',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as AnalysisReport;
}

const FRICTION_URL = 'https://www.youtube.com/watch?v=abc123';

// Seed content + a cached report under the SAME content hash the route keys on
// (sourceType 'youtube' is the first the route tries). Returns the hash used.
async function seedUnderHash(
  repo: InMemoryRepositoryT,
  cache: InMemoryCacheT,
  url: string,
  report: AnalysisReport,
): Promise<string> {
  const hash = cacheKey({ sourceType: 'youtube', url });
  const content: ContentItem = {
    id: `content-${hash.slice(0, 8)}`,
    urlHash: hash,
    sourceType: 'youtube',
    sourceUrl: url,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
  await repo.saveContent(content);
  await cache.set(hash, { ...report, urlHash: hash });
  return hash;
}

// --- HTTP harness (mirrors sibling *.route.test.ts files) ------------------

function buildApp(repo: InMemoryRepositoryT, cache: InMemoryCacheT) {
  const queue = new InMemoryQueue();
  const limiter = new InMemoryRateLimiter(1000);
  // The friction route is PUBLIC — no auth middleware (Req 2.2/1.1).
  return express()
    .use(express.json())
    .use('/api/v1', makeRouter({ repo, cache, queue, limiter, telemetry: noopTelemetry }));
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

test('400: missing required url query is rejected at the trust boundary', async () => {
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const { url, close } = await startApp(buildApp(repo, cache));
  try {
    const res = await fetch(`${url}/api/v1/friction`);
    assert.equal(res.status, 400);
    assert.equal((await res.json() as { error: string }).error, 'invalid_input');
  } finally {
    await close();
  }
});

test('503: gate dark (default config) returns capability_unavailable', async () => {
  // Default config: legalReviewComplete=false ⇒ gate not satisfied regardless of metrics.
  delete process.env.TRUST_FEED_LEGAL_OK;
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const { url, close } = await startApp(buildApp(repo, cache));
  try {
    const res = await fetch(`${url}/api/v1/friction?url=${encodeURIComponent(FRICTION_URL)}`);
    assert.equal(res.status, 503);
    assert.equal((await res.json() as { error: string }).error, 'capability_unavailable');
  } finally {
    await close();
  }
});

test('404: gate satisfied but url resolves to no content', async () => {
  process.env.TRUST_FEED_LEGAL_OK = 'true';
  try {
    const repo = await gateSatisfyingRepo();
    const cache = new InMemoryCache();
    const { url, close } = await startApp(buildApp(repo, cache));
    try {
      const res = await fetch(`${url}/api/v1/friction?url=${encodeURIComponent(FRICTION_URL)}`);
      assert.equal(res.status, 404);
      assert.equal((await res.json() as { error: string }).error, 'not_found');
    } finally {
      await close();
    }
  } finally {
    delete process.env.TRUST_FEED_LEGAL_OK;
  }
});

test('404: gate satisfied but the resolved report is not ready', async () => {
  process.env.TRUST_FEED_LEGAL_OK = 'true';
  try {
    const repo = await gateSatisfyingRepo();
    const cache = new InMemoryCache();
    // Content exists and a report is cached, but its status is needs_review.
    await seedUnderHash(repo, cache, FRICTION_URL, readyReport('rpt-nr', { status: 'needs_review' }));
    const { url, close } = await startApp(buildApp(repo, cache));
    try {
      const res = await fetch(`${url}/api/v1/friction?url=${encodeURIComponent(FRICTION_URL)}`);
      assert.equal(res.status, 404);
      assert.equal((await res.json() as { error: string }).error, 'not_found');
    } finally {
      await close();
    }
  } finally {
    delete process.env.TRUST_FEED_LEGAL_OK;
  }
});

test('200: gate satisfied + ready report cached ⇒ lens-safe overlay, no verdict/creator', async () => {
  process.env.TRUST_FEED_LEGAL_OK = 'true';
  try {
    const repo = await gateSatisfyingRepo();
    const cache = new InMemoryCache();
    const report = readyReport('rpt-ready');
    await seedUnderHash(repo, cache, FRICTION_URL, report);
    const { url, close } = await startApp(buildApp(repo, cache));
    try {
      const res = await fetch(`${url}/api/v1/friction?url=${encodeURIComponent(FRICTION_URL)}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;

      // Exactly the four lens-safe keys, nothing more.
      assert.deepEqual(
        new Set(Object.keys(body)),
        new Set(['reportId', 'framingSignals', 'evidenceSummary', 'reportUrl']),
      );
      assert.equal(body.reportId, 'rpt-ready');

      const framingSignals = body.framingSignals as Array<Record<string, unknown>>;
      assert.equal(framingSignals.length, 1);
      assert.equal(framingSignals[0]!.technique, 'Emotional Language');
      assert.equal(framingSignals[0]!.quote, 'a catastrophic collapse');
      assert.equal(framingSignals[0]!.explanation, 'hyperbolic framing');

      const evidenceSummary = body.evidenceSummary as Array<Record<string, unknown>>;
      assert.equal(evidenceSummary.length, 1);
      assert.equal(evidenceSummary[0]!.claimText, 'Unemployment fell last quarter.');
      assert.equal(evidenceSummary[0]!.evidenceStrength, 'moderate');

      assert.equal(typeof body.reportUrl, 'string');
      assert.ok((body.reportUrl as string).includes('/report/share-abc'));

      // No verdict, no creator rating anywhere in the payload (the moat).
      const serialized = JSON.stringify(body);
      for (const forbidden of ['verdict', 'creator', 'creatorRating', 'reliability', 'score']) {
        assert.equal(
          serialized.includes(forbidden),
          false,
          `lens-safe payload must not contain "${forbidden}"`,
        );
      }
    } finally {
      await close();
    }
  } finally {
    delete process.env.TRUST_FEED_LEGAL_OK;
  }
});
