// Feature: expert-review-queue — fail-closed reviewer authorization (Req 1.6).
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
//
// WHERE the reviewer-role configuration is absent, the server denies EVERY review
// route (fail closed) without blocking startup. reviewerGuard reads
// config.reviewerRole, captured from process.env.REVIEWER_ROLE at config.ts load.
// We force it empty here, then dynamic-import the config-touching modules so they
// observe the empty value (static imports are hoisted above this assignment).
process.env.REVIEWER_ROLE = '';

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';

const { makeRouter } = await import('../src/http/routes');
const { InMemoryCache, InMemoryQueue, InMemoryRepository, InMemoryRateLimiter } = await import(
  '../src/infra/memory'
);
const { noopTelemetry } = await import('../src/infra/telemetry/noop');
const { config } = await import('../src/config');

// Every review route that lists or mutates Review_Items (Req 1.5).
const REVIEW_ROUTES: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'GET', path: '/review/queue' },
  { method: 'POST', path: '/review/items/dispute:abc/claim' },
  { method: 'POST', path: '/review/items/dispute:abc/release' },
  { method: 'POST', path: '/review/items/dispute:abc/resolution' },
];

// An authenticated user — even one whose role string is 'reviewer' — must still be
// denied while the role is unconfigured, because the empty-role check fires first.
const stubUser =
  (role: string) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    req.user = { id: 'someone-1', email: 's@x.test', role };
    next();
  };

function buildApp(pre: (req: Request, res: Response, next: NextFunction) => void) {
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
  return app;
}

test('empty REVIEWER_ROLE is observed by config (fail-closed precondition)', () => {
  assert.equal(config.reviewerRole, ''); // Req 1.6 — role configuration absent
});

test('building the app/router with empty reviewerRole does not throw (startup not aborted)', () => {
  // Req 1.6 — fail-closed is a guard-time decision; constructing the router with an
  // absent reviewer role must succeed so startup is never blocked.
  assert.doesNotThrow(() => buildApp(stubUser('reviewer')));
});

test('every review route is denied 403 reviewer_role_not_configured when REVIEWER_ROLE is empty', async () => {
  const app = buildApp(stubUser('reviewer')); // even a 'reviewer' is denied while unconfigured
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/v1`;
  try {
    for (const route of REVIEW_ROUTES) {
      const res = await fetch(`${base}${route.path}`, {
        method: route.method,
        headers: route.method === 'POST' ? { 'content-type': 'application/json' } : undefined,
        body: route.method === 'POST' ? JSON.stringify({}) : undefined,
      });
      // Route still mounts and responds (no crash) — it just denies (Req 1.6).
      assert.equal(res.status, 403, `${route.method} ${route.path} should fail closed`);
      const json = (await res.json()) as { error?: string };
      assert.equal(
        json.error,
        'reviewer_role_not_configured',
        `${route.method} ${route.path} error`,
      );
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
