// Feature: trust-and-launch-bundle, protected-route auth (Validates: 5.5)
// Protected routes (requireAuth) reject unauthenticated requests with 401, while
// public routes stay open. Boots the real router behind optionalAuth on an
// ephemeral port and drives it over HTTP, so this exercises the deployed gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
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

function buildApp() {
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const queue = new InMemoryQueue();
  const limiter = new InMemoryRateLimiter(10);
  const app = express()
    .use(express.json())
    .use('/api/v1', optionalAuth, makeRouter({ repo, cache, queue, limiter, telemetry: noopTelemetry }));
  return { app, repo };
}

async function withServer(fn: (base: string, repo: InMemoryRepository) => Promise<void>) {
  const { app, repo } = buildApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, repo);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('GET /api/v1/me rejects an unauthenticated request with 401', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/me`);
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: string }).error, 'auth_required');
  });
});

test('POST /api/v1/analyses/:id/flags rejects an unauthenticated request with 401', async () => {
  await withServer(async (base, repo) => {
    // Seed a real report so auth is the only thing that can fail — proving the
    // 401 comes from the gate, not a missing-report 404.
    const now = new Date().toISOString();
    const report: AnalysisReport = {
      id: randomUUID(),
      contentId: randomUUID(),
      urlHash: 'hash',
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
    await repo.saveReport(report);

    const res = await fetch(`${base}/api/v1/analyses/${report.id}/flags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ technique: 'loaded_language' }),
    });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: string }).error, 'auth_required');
  });
});

test('GET /api/v1/policy is public and returns 200 without auth', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/v1/policy`);
    assert.equal(res.status, 200);
  });
});
