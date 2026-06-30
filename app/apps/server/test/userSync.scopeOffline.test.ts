// Feature: supabase-user-sync — example tests (task 3.8)
// Offline wiring + scope isolation. NOT property tests — plain node:test + assert.
//
// Scenario 1 (offline wiring, Req 1.3, 7.3, 7.4): buildContext() with zero keys
// composes the in-memory Repository, starts without error, ensureLocalUser issues
// no network request (verified by a fetch spy around a direct call), and a flag
// submission succeeds end-to-end over that in-memory repo.
//
// Scenario 2 (scope isolation, Req 4.1–4.5): save, workspace-create, and
// dispute-intake create NO users row for the subject (getLocalUser undefined) and
// invoke no sync (ensureLocalUser spy never fires); the dispute persists with no
// user identity (raised_by NULL by construction — the row carries no user field).

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';

// Only config-free modules are imported statically. Anything that transitively
// imports config.ts (compose, routes) is imported DYNAMICALLY below, AFTER the
// offline env is in place — otherwise config.ts (whose ./env snapshots
// process.env at import time) would freeze with the repo's postgres .env.
import { InMemoryCache, InMemoryQueue, InMemoryRateLimiter, InMemoryRepository } from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import type { AnalysisReport, FramingSignal } from '../src/types';

// --- force the offline path before config.ts snapshots process.env ---
// config.ts reads process.env exactly once, at import time, via ./env — which lets
// *real* env vars win over the repo's .env file (which pins REPO_DRIVER=postgres).
// So we pin the offline drivers/mocks here, dynamically import buildContext +
// makeRouter, then restore. Same approach as reportGraph/workspace offlineWiring tests.
const OFFLINE_ENV: Record<string, string> = {
  REPO_DRIVER: 'memory',
  CACHE_DRIVER: 'memory',
  QUEUE_DRIVER: 'memory',
  DATABASE_URL: '', // no database -> offline repo selected
  REDIS_URL: '',
  LLM_PROVIDER: 'mock',
  EVIDENCE_PROVIDER: 'mock',
  PERSPECTIVE_PROVIDER: 'mock',
};

const saved: Record<string, string | undefined> = {};
for (const key of Object.keys(OFFLINE_ENV)) {
  saved[key] = process.env[key];
  process.env[key] = OFFLINE_ENV[key];
}

const { buildContext } = await import('../src/compose');
const { makeRouter } = await import('../src/http/routes');

for (const key of Object.keys(OFFLINE_ENV)) {
  if (saved[key] === undefined) delete process.env[key];
  else process.env[key] = saved[key];
}

// The flag route validates req.user.id with syncedIdentitySchema, so the subject
// must be a valid UUID. The save route validates :id with reportIdParam (UUID).
const SUBJECT = '11111111-1111-1111-1111-111111111111';
const TECHNIQUE = 'Emotional Language';

function seededReport(id: string): AnalysisReport {
  const now = new Date().toISOString();
  const signal: FramingSignal = {
    technique: TECHNIQUE,
    severity: 'medium',
    description: `Use of ${TECHNIQUE}.`,
    examples: [{ text: 'sample quote', explanation: 'why it is this technique', startIndex: 0, endIndex: 12 }],
  };
  return {
    id,
    contentId: 'content-1',
    urlHash: `hash-${id}`,
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    claims: [],
    framingSignals: [signal],
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Mount makeRouter behind a stub that sets req.user (no JWT plumbing), so
// requireAuth passes — the established pattern from flag.persist.test.ts.
function mountApp(repo: InMemoryRepository) {
  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.user = { id: SUBJECT, email: 'u@x.test', role: 'authenticated' } as Request['user'];
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1',
    authStub,
    makeRouter({
      repo,
      cache: new InMemoryCache(),
      queue: new InMemoryQueue(),
      limiter: new InMemoryRateLimiter(1000),
      telemetry: noopTelemetry,
    }),
  );
  return app;
}

async function withServer(app: express.Express, fn: (base: string) => Promise<void>): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}/api/v1`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('offline wiring: zero-key buildContext composes in-memory repo; ensureLocalUser does no network; flag succeeds end-to-end (Req 1.3, 7.3, 7.4)', async () => {
  // buildContext() completes without error in Offline_Mode (Req 7.3) ...
  const { repo } = buildContext();
  // ... and with no DATABASE_URL composes the in-memory Repository (the offline path).
  assert.ok(
    repo instanceof InMemoryRepository,
    'expected the offline path (no DATABASE_URL) to compose an InMemoryRepository',
  );

  // ensureLocalUser derives the Local_User solely from the claims and issues NO
  // external request (Req 1.3, 7.4). Prove it: spy global fetch around a direct
  // call and assert it never fires (the sync is pure repo logic, no network seam).
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
    fetchCalls++;
    return realFetch(...args);
  }) as typeof fetch;
  try {
    await repo.ensureLocalUser({ id: SUBJECT, email: 'u@x.test', role: 'authenticated' });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetchCalls, 0, 'ensureLocalUser must issue no network request (Req 1.3, 7.4)');

  const synced = await repo.getLocalUser(SUBJECT);
  assert.ok(synced, 'a Local_User keyed to the subject exists after sync');
  assert.equal(synced.id, SUBJECT);

  // End-to-end: a flag submission succeeds through the composed in-memory repo (Req 7.4).
  const reportId = randomUUID();
  await repo.saveReport(seededReport(reportId));
  const app = mountApp(repo);
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/analyses/${reportId}/flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ technique: TECHNIQUE }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(repo.flags.length, 1);
    assert.equal(repo.flags[0]!.userId, SUBJECT);
    // The flag resolves to the synced Local_User keyed to the subject.
    assert.ok(await repo.getLocalUser(SUBJECT), 'flag user_id resolves to the synced Local_User');
  });
});

test('scope isolation: save, workspace-create, and dispute-intake create no users row and invoke no sync; dispute raised_by is NULL (Req 4.1–4.5)', async () => {
  const repo = new InMemoryRepository();

  // Spy on ensureLocalUser so we can assert the subject-keyed / anonymous flows
  // never invoke User_Sync (Req 4.3, 4.5).
  let syncCalls = 0;
  const realEnsure = repo.ensureLocalUser.bind(repo);
  repo.ensureLocalUser = async (u) => {
    syncCalls++;
    return realEnsure(u);
  };

  const reportId = randomUUID();
  await repo.saveReport(seededReport(reportId));

  const app = mountApp(repo);
  await withServer(app, async (base) => {
    // --- Saved_Report: keyed on the subject as TEXT, needs no Local_User (Req 4.1, 4.3) ---
    const saveRes = await fetch(`${base}/analyses/${reportId}/save`, { method: 'POST' });
    assert.equal(saveRes.status, 200);
    assert.equal(await repo.getLocalUser(SUBJECT), undefined, 'save creates no users row for the subject (Req 4.1)');

    // --- Workspace_Record: keyed on the subject as TEXT, needs no Local_User (Req 4.2, 4.3) ---
    const wsRes = await fetch(`${base}/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Newsroom' }),
    });
    assert.equal(wsRes.status, 201);
    assert.equal(await repo.getLocalUser(SUBJECT), undefined, 'workspace-create creates no users row for the subject (Req 4.2)');

    // --- Dispute: anonymous intake, raised_by NULL, no Local_User (Req 4.4, 4.5) ---
    const dispRes = await fetch(`${base}/analyses/${reportId}/disputes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'This framing is misleading.' }),
    });
    assert.equal(dispRes.status, 201);
    assert.equal(await repo.getLocalUser(SUBJECT), undefined, 'dispute-intake creates no users row for the subject (Req 4.4)');

    // The persisted dispute carries no user identity — raised_by is NULL by
    // construction (the row shape has no user/raisedBy field at all) (Req 4.4).
    assert.equal(repo.disputes.length, 1);
    const persisted = repo.disputes[0]!;
    assert.equal(persisted.reportId, reportId);
    assert.ok(!('raisedBy' in persisted), 'dispute must carry no raised_by (NULL)');
    assert.ok(!('userId' in persisted), 'dispute must carry no user identity');
  });

  // No subject-keyed or anonymous flow invoked User_Sync (Req 4.3, 4.5).
  assert.equal(syncCalls, 0, 'save / workspace-create / dispute-intake must invoke no User_Sync');
});
