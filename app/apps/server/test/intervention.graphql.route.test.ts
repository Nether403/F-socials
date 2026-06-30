// Feature: intervention-and-scale, task 10.5 — example/integration test for the
// Institutional API POST /api/v1/graphql route.
// Validates: Requirements 7.6, 7.8, 9.1, 9.4, 9.5
//
// Drives the REAL route handler (makeRouter + InMemory infra over an ephemeral
// HTTP server) end to end. The route order is load-bearing:
//   apiKeyAuth → per-key rate limiter → Institutional trust gate → graphql() → sendNeutral.
// The four observable behaviours asserted here:
//   1. 401 without a valid API key — the query is never executed (auth precedes
//      everything; no `data`/`errors` GraphQL envelope is produced). (Req 9.5)
//   2. Invalid GraphQL syntax / unknown field ⇒ a structured `{ errors }` response
//      with resolvers NOT run (graphql-js validates before execution). (Req 7.6, 7.8)
//   3. Empty corpus ⇒ data.claims = { items: [], totalCount: 0 } with no `errors`
//      (read-only resolution over a repo with no reports). (Req 9.1, 9.4)
//   4. Read-only resolution against the in-memory Report_Graph returns the seeded
//      claim data and performs NO write (report/claim-row counts unchanged). (Req 9.1, 9.4)
//
// Gate strategy — PREFER the real gate. config.trustThresholds is a live getter
// over process.env, so TRUST_API_* toggles the real Institutional gate every
// request. The in-memory driver's listHumanSignals only models disputes (always a
// disagreement), so to reach the gate-satisfied path we subclass
// InMemoryRepository and synthesize one agreeing expert-review Human_Signal that
// shares a (reportId, claimId) with a seeded matched_fact_check Evidence_Outcome
// ⇒ coverage 1.0, agreement 1.0. Same technique as the friction route test, but
// keyed on TRUST_API_* (this capability) rather than TRUST_FEED_*.

// Set the API trust-gate env BEFORE importing config (read live by its getter anyway).
process.env.TRUST_API_COVERAGE_MIN = '0';
process.env.TRUST_API_AGREEMENT_MIN = '0';

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';

const { makeRouter } = await import('../src/http/routes');
const { InMemoryCache, InMemoryQueue, InMemoryRateLimiter, InMemoryRepository } = await import(
  '../src/infra/memory'
);
const { noopTelemetry } = await import('../src/infra/telemetry/noop');
import type { AnalysisReport, AuditRecord, EvidenceOutcome } from '../src/types';
import type { HumanSignal } from '../src/core/kpi';
import type {
  InMemoryRepository as InMemoryRepositoryT,
  InMemoryCache as InMemoryCacheT,
} from '../src/infra/memory';

// --- gate helpers (mirrors intervention.friction.route.test.ts) ------------

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
  // citationCoverage = 1.0 (> min) and modelHumanAgreement = 1.0 (> min). This
  // is an audit record only — it writes NO claim rows, so the corpus seen by the
  // GraphQL resolvers is still empty until a report is explicitly saved.
  await repo.saveAuditRecord(GATE_REPORT_ID, makeAudit(GATE_CLAIM_ID, 'matched_fact_check'));
  return repo;
}

// A gate-valid ready report with one claim, used to exercise read-only resolution.
function readyReport(id: string): AnalysisReport {
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
    framingSignals: [],
    contextCards: [],
    perspectives: [],
    shareSlug: 'share-abc',
    createdAt: now,
    updatedAt: now,
  } as AnalysisReport;
}

// --- HTTP harness (mirrors sibling *.route.test.ts files) ------------------

function buildApp(repo: InMemoryRepositoryT, cache: InMemoryCacheT) {
  const queue = new InMemoryQueue();
  const limiter = new InMemoryRateLimiter(1000);
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

// POST a GraphQL query, optionally with a Bearer API key.
async function postGraphql(
  base: string,
  body: { query: string; variables?: Record<string, unknown> },
  apiKey?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${base}/api/v1/graphql`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// =========================================================================== //

test('401: no/invalid API key ⇒ rejected before the query is executed', async () => {
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const { url, close } = await startApp(buildApp(repo, cache));
  try {
    // No Authorization header.
    const missing = await postGraphql(url, { query: '{ claims { totalCount } }' });
    assert.equal(missing.status, 401);
    // apiKeyAuth answers with an error envelope, NOT a GraphQL { data }/{ errors }
    // envelope — proof the query was never executed (Req 9.5).
    assert.equal(missing.json.error, 'api_key_required');
    assert.equal('data' in missing.json, false);

    // Present but unknown key (never issued) ⇒ still 401, still no execution.
    const bogus = await postGraphql(url, { query: '{ claims { totalCount } }' }, 'not-a-real-key');
    assert.equal(bogus.status, 401);
    assert.equal(bogus.json.error, 'invalid_api_key');
    assert.equal('data' in bogus.json, false);
  } finally {
    await close();
  }
});

test('invalid GraphQL syntax ⇒ { errors } and resolvers are not run', async () => {
  process.env.TRUST_API_LEGAL_OK = 'true';
  try {
    const repo = await gateSatisfyingRepo();
    const cache = new InMemoryCache();
    const { keyId, plaintext } = await repo.createApiKey('inst-1');
    assert.ok(keyId && plaintext);
    const { url, close } = await startApp(buildApp(repo, cache));
    try {
      // Syntactically invalid query — graphql-js fails to parse, returns errors,
      // and never enters execution (so no resolver runs).
      const bad = await postGraphql(url, { query: '{ claims ' }, plaintext);
      assert.equal(bad.status, 200); // GraphQL-over-HTTP returns 200 with an errors body.
      assert.ok(Array.isArray(bad.json.errors), 'expected an errors array for invalid syntax');
      assert.ok((bad.json.errors as unknown[]).length > 0);
      // No resolved data on a parse failure.
      assert.ok(bad.json.data === undefined || bad.json.data === null);

      // Unknown field — passes parse but fails validation, again before execution.
      const unknown = await postGraphql(url, { query: '{ nonexistentField }' }, plaintext);
      assert.equal(unknown.status, 200);
      assert.ok(Array.isArray(unknown.json.errors), 'expected an errors array for unknown field');
      assert.ok((unknown.json.errors as unknown[]).length > 0);
      assert.ok(unknown.json.data === undefined || unknown.json.data === null);
    } finally {
      await close();
    }
  } finally {
    delete process.env.TRUST_API_LEGAL_OK;
  }
});

test('empty corpus ⇒ data.claims = { items: [], totalCount: 0 }, no errors', async () => {
  process.env.TRUST_API_LEGAL_OK = 'true';
  try {
    // gateSatisfyingRepo seeds only an audit record (for the gate), no reports ⇒
    // the Report_Graph the resolvers read is empty.
    const repo = await gateSatisfyingRepo();
    const cache = new InMemoryCache();
    const { plaintext } = await repo.createApiKey('inst-1');
    const { url, close } = await startApp(buildApp(repo, cache));
    try {
      const res = await postGraphql(
        url,
        { query: '{ claims { items { claimUid } totalCount } }' },
        plaintext,
      );
      assert.equal(res.status, 200);
      assert.equal(res.json.errors, undefined, `unexpected errors: ${JSON.stringify(res.json.errors)}`);
      const data = res.json.data as { claims: { items: unknown[]; totalCount: number } };
      assert.deepEqual(data.claims.items, []);
      assert.equal(data.claims.totalCount, 0);
    } finally {
      await close();
    }
  } finally {
    delete process.env.TRUST_API_LEGAL_OK;
  }
});

test('read-only resolution ⇒ returns seeded claim data and performs no write', async () => {
  process.env.TRUST_API_LEGAL_OK = 'true';
  try {
    const repo = await gateSatisfyingRepo();
    const cache = new InMemoryCache();
    await repo.saveReport(readyReport('rpt-ready'));
    const { plaintext } = await repo.createApiKey('inst-1');

    // Capture the persisted state BEFORE the query to prove the read path mutates nothing.
    const reportsBefore = repo.reports.size;
    const claimRowsBefore = repo.claimRows.get('rpt-ready')?.length ?? 0;

    const { url, close } = await startApp(buildApp(repo, cache));
    try {
      const res = await postGraphql(
        url,
        { query: '{ claims { items { claimUid reportId claimText evidenceStrength } totalCount } }' },
        plaintext,
      );
      assert.equal(res.status, 200);
      assert.equal(res.json.errors, undefined, `unexpected errors: ${JSON.stringify(res.json.errors)}`);
      const claims = (res.json.data as {
        claims: {
          items: Array<{ claimUid: string; reportId: string; claimText: string; evidenceStrength: string }>;
          totalCount: number;
        };
      }).claims;

      assert.equal(claims.totalCount, 1);
      assert.equal(claims.items.length, 1);
      const item = claims.items[0]!;
      assert.equal(item.claimUid, 'claim-1');
      assert.equal(item.reportId, 'rpt-ready');
      assert.equal(item.claimText, 'Unemployment fell last quarter.');
      assert.equal(item.evidenceStrength, 'moderate');

      // No write occurred along the read-only GraphQL path (Req 9.1, 9.4).
      assert.equal(repo.reports.size, reportsBefore);
      assert.equal(repo.claimRows.get('rpt-ready')?.length ?? 0, claimRowsBefore);
    } finally {
      await close();
    }
  } finally {
    delete process.env.TRUST_API_LEGAL_OK;
  }
});
