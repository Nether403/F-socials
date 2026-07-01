// Feature: trust-and-launch-bundle, protected-route auth (Validates: 5.5)
// Protected routes (requireAuth) reject unauthenticated requests with 401, while
// public routes stay open. Boots the real router behind optionalAuth on an
// ephemeral port and drives it over HTTP, so this exercises the deployed gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withTestApp } from './helpers/makeTestApp';
import type { Repository } from '../src/infra/ports';
import type { AnalysisReport } from '../src/types';

// Boots the real router behind the deployed optionalAuth gate so these tests
// exercise the real protected-route 401 behaviour.
async function withServer(fn: (base: string, repo: Repository) => Promise<void>) {
  await withTestApp({ auth: 'real' }, (app) => fn(app.base, app.repo));
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
