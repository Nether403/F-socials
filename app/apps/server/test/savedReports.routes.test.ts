// Feature: accounts-save-history — route integration tests for the saved-report
// endpoints (task 5.4). Covers auth gating and reader scoping over real HTTP
// against the in-memory infra:
//   - 401 without a token (requireAuth, via optionalAuth + no Authorization)
//   - 400 on a malformed (non-UUID) :id (zod reportIdParam, Req 10.4)
//   - 404 on save to a missing report (Req 7.4)
//   - 200 success scoped to the verified reader (Req 7.1, 9.1, 10.5)
//   - empty-collection history for a reader with no saves (Req 10.8)
//
// Validates: Requirements 7.4, 7.5, 8.4, 9.7, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.8
//
// Auth seam follows the sibling route tests: 401 cases boot the router behind the
// real optionalAuth gate (no token -> 401), while authed cases mount a tiny
// middleware that sets req.user (no JWT plumbing) so requireAuth passes and the
// route's validation/scoping logic is what's exercised.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { makeRouter } from '../src/http/routes';
import { optionalAuth } from '../src/http/auth';
import {
  InMemoryCache,
  InMemoryQueue,
  InMemoryRateLimiter,
  InMemoryRepository,
} from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import type { AnalysisReport } from '../src/types';

// Build the app with either the real optionalAuth gate (stubUserId omitted) or an
// auth stub that sets req.user to the given reader id (stubUserId provided).
function buildApp(stubUserId?: string) {
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const queue = new InMemoryQueue();
  const limiter = new InMemoryRateLimiter(1000);
  const auth = stubUserId
    ? (req: Request, _res: Response, next: NextFunction): void => {
        req.user = { id: stubUserId, role: 'authenticated' };
        next();
      }
    : optionalAuth;
  const app = express()
    .use(express.json())
    .use('/api/v1', auth, makeRouter({ repo, cache, queue, limiter, telemetry: noopTelemetry }));
  return { app, repo };
}

async function withServer(
  stubUserId: string | undefined,
  fn: (base: string, repo: InMemoryRepository) => Promise<void>,
): Promise<void> {
  const { app, repo } = buildApp(stubUserId);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, repo);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function seedReport(repo: InMemoryRepository, id: string): Promise<void> {
  const now = new Date().toISOString();
  const report: AnalysisReport = {
    id,
    contentId: randomUUID(),
    urlHash: `hash-${id}`,
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    claims: [],
    framingSignals: [],
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
  };
  return repo.saveReport(report);
}

// --- 401 without a token (Req 7.5, 8.4, 9.7, 10.1, 10.2, 10.3, 10.6) ---------

test('POST /analyses/:id/save without a token responds 401 and persists nothing', async () => {
  await withServer(undefined, async (base, repo) => {
    const id = randomUUID();
    await seedReport(repo, id); // seed so auth is the only thing that can fail
    const res = await fetch(`${base}/api/v1/analyses/${id}/save`, { method: 'POST' });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: string }).error, 'auth_required');
    assert.deepEqual(await repo.listSavedReports('anyone'), []);
  });
});

test('DELETE /analyses/:id/save without a token responds 401', async () => {
  await withServer(undefined, async (base) => {
    const res = await fetch(`${base}/api/v1/analyses/${randomUUID()}/save`, { method: 'DELETE' });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: string }).error, 'auth_required');
  });
});

test('GET /saved-reports without a token responds 401 and returns no reports', async () => {
  await withServer(undefined, async (base) => {
    const res = await fetch(`${base}/api/v1/saved-reports`);
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: string }).error, 'auth_required');
  });
});

// --- 400 on a malformed id (Req 10.4) ----------------------------------------

test('POST /analyses/:id/save with a malformed id responds 400 and persists nothing', async () => {
  await withServer('reader-1', async (base, repo) => {
    const res = await fetch(`${base}/api/v1/analyses/not-a-uuid/save`, { method: 'POST' });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: string }).error, 'invalid_id');
    assert.deepEqual(await repo.listSavedReports('reader-1'), []);
  });
});

test('DELETE /analyses/:id/save with a malformed id responds 400', async () => {
  await withServer('reader-1', async (base) => {
    const res = await fetch(`${base}/api/v1/analyses/not-a-uuid/save`, { method: 'DELETE' });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: string }).error, 'invalid_id');
  });
});

// --- 404 on save to a missing report (Req 7.4) -------------------------------

test('POST /analyses/:id/save on a nonexistent report responds 404 and persists nothing', async () => {
  await withServer('reader-1', async (base, repo) => {
    const id = randomUUID(); // valid UUID shape, never seeded
    const res = await fetch(`${base}/api/v1/analyses/${id}/save`, { method: 'POST' });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { error: string }).error, 'not_found');
    assert.deepEqual(await repo.listSavedReports('reader-1'), []);
  });
});

// --- 200 success scoped to the verified reader (Req 7.1, 9.1, 10.5) ----------

test('save then history is scoped to the verified reader and excludes other readers', async () => {
  await withServer('reader-A', async (base, repo) => {
    const id = randomUUID();
    await seedReport(repo, id);

    const saveRes = await fetch(`${base}/api/v1/analyses/${id}/save`, { method: 'POST' });
    assert.equal(saveRes.status, 200);
    assert.deepEqual(await saveRes.json(), { ok: true, saved: true });

    const histRes = await fetch(`${base}/api/v1/saved-reports`);
    assert.equal(histRes.status, 200);
    const entries = (await histRes.json()) as Array<{ reportId: string; savedAt: string }>;
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.reportId, id);
    assert.equal(typeof entries[0]!.savedAt, 'string');

    // The save landed under reader-A only — a different reader sees nothing.
    assert.deepEqual(await repo.listSavedReports('reader-B'), []);
  });
});

test('DELETE /analyses/:id/save returns success even when the report was never saved', async () => {
  await withServer('reader-1', async (base, repo) => {
    const id = randomUUID();
    const res = await fetch(`${base}/api/v1/analyses/${id}/save`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, saved: false });
    assert.deepEqual(await repo.listSavedReports('reader-1'), []);
  });
});

// --- empty-collection history (Req 10.8) -------------------------------------

test('GET /saved-reports for a reader with no saves responds 200 and an empty array', async () => {
  await withServer('reader-empty', async (base) => {
    const res = await fetch(`${base}/api/v1/saved-reports`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });
});
