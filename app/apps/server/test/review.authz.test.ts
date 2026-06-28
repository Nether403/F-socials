// Feature: expert-review-queue — Reviewer authorization (Requirement 1).
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
//
// reviewerGuard reads config.reviewerRole, which config.ts captures from
// process.env.REVIEWER_ROLE at module-load time. ESM hoists static `import`s
// ABOVE top-level statements, so a plain assignment here would run too late.
// We therefore set the env first, then pull the config-touching modules in via
// dynamic import so they observe the value below.
process.env.REVIEWER_ROLE = 'reviewer';

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';

const { makeRouter } = await import('../src/http/routes');
const { optionalAuth } = await import('../src/http/auth');
const { InMemoryCache, InMemoryQueue, InMemoryRepository, InMemoryRateLimiter } = await import(
  '../src/infra/memory'
);
const { noopTelemetry } = await import('../src/infra/telemetry/noop');

const REVIEWER_ROLE = 'reviewer';

// Every review route that lists or mutates Review_Items (Req 1.5). The guard runs
// before id parsing / body validation, so a placeholder id is sufficient to prove
// each route is gated.
const REVIEW_ROUTES: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'GET', path: '/review/queue' },
  { method: 'POST', path: '/review/items/dispute:abc/claim' },
  { method: 'POST', path: '/review/items/dispute:abc/release' },
  { method: 'POST', path: '/review/items/dispute:abc/resolution' },
];

// Mirrors flag.persist.test.ts: a stub middleware sets req.user before the router,
// so requireAuth passes and we isolate the reviewerGuard role decision.
const stubUser =
  (role: string) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    req.user = { id: 'reviewer-1', email: 'r@x.test', role };
    next();
  };

type Pre = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

async function startApp(pre: Pre): Promise<{ base: string; close: () => Promise<void> }> {
  const repo = new InMemoryRepository();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1',
    pre,
    makeRouter({
      repo,
      cache: new InMemoryCache(),
      queue: new InMemoryQueue(),
      limiter: new InMemoryRateLimiter(1000),
      telemetry: noopTelemetry,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/api/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('valid reviewer (role === REVIEWER_ROLE) reaches the handler — GET /review/queue → 200', async () => {
  const { base, close } = await startApp(stubUser(REVIEWER_ROLE));
  try {
    const res = await fetch(`${base}/review/queue`);
    assert.equal(res.status, 200); // Req 1.1 — guard forwards to the route handler
    const body = await res.json();
    assert.ok(Array.isArray(body)); // empty queue still returns a list
  } finally {
    await close();
  }
});

test('no Authorization bearer token → 401 on a review route (real auth path)', async () => {
  // Mirrors flag.unauth.test.ts: the real optionalAuth leaves req.user unset for an
  // anonymous request, so requireAuth (layered before reviewerGuard) rejects with 401.
  const { base, close } = await startApp(optionalAuth);
  try {
    const res = await fetch(`${base}/review/queue`); // no Authorization header
    assert.equal(res.status, 401); // Req 1.2
    const json = (await res.json()) as { error?: string };
    assert.equal(json.error, 'auth_required');
  } finally {
    await close();
  }
});

test('invalid bearer token → 401 on a review route (real auth path)', async () => {
  // A junk token through the real requireAuth chain yields 401 — invalid_token when
  // the JWT secret is configured, auth_not_configured otherwise. Either way the
  // handler is never reached (Req 1.3).
  const { base, close } = await startApp(optionalAuth);
  try {
    const res = await fetch(`${base}/review/queue`, {
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    assert.equal(res.status, 401); // Req 1.3
    const json = (await res.json()) as { error?: string };
    assert.ok(
      json.error === 'invalid_token' || json.error === 'auth_not_configured',
      `expected an invalid-token 401, got ${String(json.error)}`,
    );
  } finally {
    await close();
  }
});

test('authenticated NON-reviewer → 403 not_a_reviewer on a review route', async () => {
  const { base, close } = await startApp(stubUser('authenticated'));
  try {
    const res = await fetch(`${base}/review/queue`);
    assert.equal(res.status, 403); // Req 1.4
    const json = (await res.json()) as { error?: string };
    assert.equal(json.error, 'not_a_reviewer');
  } finally {
    await close();
  }
});

test('every review route rejects an authenticated non-reviewer with 403 (Req 1.5)', async () => {
  const { base, close } = await startApp(stubUser('authenticated'));
  try {
    for (const route of REVIEW_ROUTES) {
      const res = await fetch(`${base}${route.path}`, {
        method: route.method,
        headers: route.method === 'POST' ? { 'content-type': 'application/json' } : undefined,
        body: route.method === 'POST' ? JSON.stringify({}) : undefined,
      });
      assert.equal(res.status, 403, `${route.method} ${route.path} should be guarded`);
      const json = (await res.json()) as { error?: string };
      assert.equal(json.error, 'not_a_reviewer', `${route.method} ${route.path} error`);
    }
  } finally {
    await close();
  }
});
