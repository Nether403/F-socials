// Feature: expert-review-queue — review route validation at the trust boundary.
//
// These tests assert that the /review routes reject malformed/out-of-vocabulary
// input with 400 BEFORE anything is persisted, and that every enumerated
// Resolution_Outcome is accepted (Requirements 2.5, 4.2, 4.3).
//
// Harness mirrors flag.persist.test.ts: a tiny authStub sets req.user before the
// router so requireAuth passes; to ALSO clear reviewerGuard the stubbed role must
// equal config.reviewerRole, which is read from REVIEWER_ROLE once at config
// import. config is read at import time, so REVIEWER_ROLE is set here and the
// config-dependent routes module is loaded via dynamic import AFTER that — ESM
// static imports are hoisted and would otherwise evaluate config too early.

process.env.REVIEWER_ROLE = 'reviewer'; // set before the routes/config module loads

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { InMemoryCache, InMemoryQueue, InMemoryRepository, InMemoryRateLimiter } from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import { RESOLUTION_OUTCOMES } from '../src/core/reviewOutcome';
import type { AnalysisReport } from '../src/types';

// Dynamic import so config (via auth) evaluates REVIEWER_ROLE AFTER it is set above.
const { makeRouter } = await import('../src/http/routes');

const REVIEWER_ROLE = 'reviewer';
const USER = { id: 'reviewer-1', email: 'r@x.test', role: REVIEWER_ROLE };
const REPORT_ID = 'report-under-review';

function seededReport(): AnalysisReport {
  const now = new Date().toISOString();
  return {
    id: REPORT_ID,
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
  };
}

// Boot an ephemeral server around the given repo, mirroring flag.persist.test.ts.
async function boot(repo: InMemoryRepository): Promise<{ base: string; close: () => Promise<void> }> {
  const cache = new InMemoryCache();
  const queue = new InMemoryQueue();
  const limiter = new InMemoryRateLimiter(1000);

  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.user = USER; // requireAuth passes; role === reviewerRole so reviewerGuard passes too
    next();
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1', authStub, makeRouter({ repo, cache, queue, limiter, telemetry: noopTelemetry }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/api/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Seed a pending dispute with a known id; returns its Review_Item id ("dispute:<id>").
async function seedDispute(repo: InMemoryRepository, sourceId: string): Promise<string> {
  await repo.createDispute({
    id: sourceId,
    reportId: REPORT_ID,
    reason: 'the surfaced framing example seems thin',
    createdAt: new Date().toISOString(),
  });
  return `dispute:${sourceId}`;
}

// Req 2.5 — an out-of-set status filter is rejected at the boundary: 400, no items.
test('GET /review/queue with an invalid status filter is rejected (400, no items)', async () => {
  const repo = new InMemoryRepository();
  await repo.saveReport(seededReport());
  await seedDispute(repo, 'd-bogus-filter');
  const { base, close } = await boot(repo);
  try {
    const res = await fetch(`${base}/review/queue?status=bogus`);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'invalid_input');
    // No items leak through on a rejected filter — the body is the error object, not an array.
    assert.equal(Array.isArray(body), false);
  } finally {
    await close();
  }
});

// Req 2.5 — a valid filter and the no-filter case both return 200 with an array.
test('GET /review/queue with a valid filter and with no filter both return 200 + array', async () => {
  const repo = new InMemoryRepository();
  await repo.saveReport(seededReport());
  await seedDispute(repo, 'd-valid-filter');
  const { base, close } = await boot(repo);
  try {
    const filtered = await fetch(`${base}/review/queue?status=pending`);
    assert.equal(filtered.status, 200);
    assert.equal(Array.isArray(await filtered.json()), true);

    const all = await fetch(`${base}/review/queue`);
    assert.equal(all.status, 200);
    assert.equal(Array.isArray(await all.json()), true);
  } finally {
    await close();
  }
});

// Req 4.2, 4.3 — an out-of-set outcome is rejected: 400, nothing persisted.
test('POST resolution with an out-of-set outcome is rejected and persists nothing', async () => {
  const repo = new InMemoryRepository();
  await repo.saveReport(seededReport());
  const itemId = await seedDispute(repo, 'd-bad-outcome');
  const { base, close } = await boot(repo);
  try {
    const res = await fetch(`${base}/review/items/${itemId}/resolution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'misinformation' }), // not in RESOLUTION_OUTCOMES
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error?: string }).error, 'invalid_input');

    const row = repo.disputes.find((d) => d.id === 'd-bad-outcome')!;
    assert.equal(row.resolution, null); // nothing persisted
    assert.equal(row.reviewStatus, 'pending'); // still pending
  } finally {
    await close();
  }
});

// Req 4.3 — an oversized note (> 2000 chars) is rejected: 400, nothing persisted.
test('POST resolution with an oversized note is rejected and persists nothing', async () => {
  const repo = new InMemoryRepository();
  await repo.saveReport(seededReport());
  const itemId = await seedDispute(repo, 'd-big-note');
  const { base, close } = await boot(repo);
  try {
    const res = await fetch(`${base}/review/items/${itemId}/resolution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: RESOLUTION_OUTCOMES[0], note: 'x'.repeat(2001) }),
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error?: string }).error, 'invalid_input');

    const row = repo.disputes.find((d) => d.id === 'd-big-note')!;
    assert.equal(row.resolution, null); // nothing persisted
    assert.equal(row.reviewStatus, 'pending'); // still pending
  } finally {
    await close();
  }
});

// Req 4.2 — EACH enumerated Resolution_Outcome is accepted: 200, row resolved with it.
test('POST resolution accepts every enumerated outcome and resolves the row', async () => {
  const repo = new InMemoryRepository();
  await repo.saveReport(seededReport());
  const { base, close } = await boot(repo);
  try {
    for (const outcome of RESOLUTION_OUTCOMES) {
      const sourceId = `d-${outcome}`;
      const itemId = await seedDispute(repo, sourceId); // fresh pending dispute per outcome

      const res = await fetch(`${base}/review/items/${itemId}/resolution`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      assert.equal(res.status, 200, `outcome ${outcome} should be accepted`);

      const row = repo.disputes.find((d) => d.id === sourceId)!;
      assert.equal(row.reviewStatus, 'resolved', `row for ${outcome} should be resolved`);
      assert.equal(row.resolution?.outcome, outcome, `row for ${outcome} should record that outcome`);
    }
  } finally {
    await close();
  }
});

// Req 4.x boundary — a malformed Review_Item id is rejected before any lookup.
test('POST resolution with a malformed :id is rejected (400 invalid_review_item_id)', async () => {
  const repo = new InMemoryRepository();
  await repo.saveReport(seededReport());
  const { base, close } = await boot(repo);
  try {
    const res = await fetch(`${base}/review/items/bogus/resolution`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: RESOLUTION_OUTCOMES[0] }),
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error?: string }).error, 'invalid_review_item_id');
  } finally {
    await close();
  }
});
