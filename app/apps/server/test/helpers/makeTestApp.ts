// Feature: test-harness — shared bootstrap for HTTP route tests.
//
// Folds the four-part boilerplate that the route tests currently duplicate
// (~build in-memory infra + define an auth stub + mount makeRouter on an express
// app + listen(0)/close) into one helper. Production wiring is unchanged: this
// assembles the SAME makeRouter(deps) the app's index.ts uses, over in-memory
// infra, so tests still exercise the real router and the real auth middleware.
//
// Why this exists: graphify surfaced InMemoryRepository as a ~120-import "god
// node" and the route tests as one low-cohesion community (0.04) — both are
// artifacts of every route test re-deriving this same fixture. Importing this
// helper instead of InMemoryRepository directly collapses that fan-in.

import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { makeRouter } from '../../src/http/routes';
import { optionalAuth } from '../../src/http/auth';
import {
  InMemoryCache,
  InMemoryQueue,
  InMemoryRateLimiter,
  InMemoryRepository,
} from '../../src/infra/memory';
import { noopTelemetry } from '../../src/infra/telemetry/noop';
import type { Cache, Queue, RateLimiter, Repository, Telemetry } from '../../src/infra/ports';
import type { AuthUser } from '../../src/auth/supabase';
import type { LLMProvider } from '../../src/core/coaching';

// The four auth seams the existing route tests already use, named once here:
//  - 'real'         : the deployed optionalAuth gate (no token -> anonymous -> 401)
//  - 'unconfigured' : mirrors optionalAuth's no-JWT-secret branch (Bearer -> 401),
//                     deterministic regardless of the ambient SUPABASE_JWT_SECRET
//  - 'header'       : x-test-user header sets req.user (one app, many identities)
//  - { user }       : a fixed req.user for every request
export type AuthOption = 'real' | 'unconfigured' | 'header' | { user: AuthUser };

function headerAuth(req: Request, _res: Response, next: NextFunction): void {
  const u = req.header('x-test-user');
  if (u) req.user = { id: u, role: 'authenticated' };
  next();
}

function fixedAuth(user: AuthUser) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.user = user;
    next();
  };
}

// Mirrors optionalAuth's unconfigured branch: a Bearer header with no JWT secret
// -> 401 auth_not_configured; anything else proceeds anonymous.
function unconfiguredAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.headers.authorization?.startsWith('Bearer ')) {
    next();
    return;
  }
  res.status(401).json({ error: 'auth_not_configured' });
}

function authMiddleware(auth: AuthOption) {
  if (auth === 'real') return optionalAuth;
  if (auth === 'unconfigured') return unconfiguredAuth;
  if (auth === 'header') return headerAuth;
  return fixedAuth(auth.user);
}

export interface TestAppOptions<R extends Repository = Repository> {
  /** Auth seam to mount before the router. Default 'header'. */
  auth?: AuthOption;
  /** Inject a custom repo (e.g. a failing repo for 5xx tests). Default in-memory. */
  repo?: R;
  cache?: Cache;
  queue?: Queue;
  /** Pre-built limiter; takes precedence over `rateLimit`. */
  limiter?: RateLimiter;
  /** In-memory limiter cap (per day) when no `limiter` is given. Default 1000. */
  rateLimit?: number;
  telemetry?: Telemetry;
  coachingLLM?: LLMProvider;
  /** Router mount path. Default '/api/v1'. */
  mountPath?: string;
}

export interface TestApp<R extends Repository = Repository> {
  /** Server root, e.g. http://127.0.0.1:54321 — append '/api/v1/...'. */
  base: string;
  /** base + mountPath, e.g. http://127.0.0.1:54321/api/v1. */
  apiBase: string;
  /**
   * The repo backing the app. Defaults to InMemoryRepository (so `app.repo.flags`
   * / `.disputes` are typed) unless a custom repo was injected.
   */
  repo: R;
  cache: Cache;
  queue: Queue;
  limiter: RateLimiter;
  telemetry: Telemetry;
  router: Router;
  /** Stop the server and free the port. Pair with t.after(app.close). */
  close: () => Promise<void>;
}

/**
 * Boot an express app with the real v1 router over in-memory infra on an
 * ephemeral port. Caller is responsible for close() — or use withTestApp().
 */
export async function makeTestApp<R extends Repository = InMemoryRepository>(
  opts: TestAppOptions<R> = {},
): Promise<TestApp<R>> {
  const repo = (opts.repo ?? new InMemoryRepository()) as R;
  const cache = opts.cache ?? new InMemoryCache();
  const queue = opts.queue ?? new InMemoryQueue();
  const limiter = opts.limiter ?? new InMemoryRateLimiter(opts.rateLimit ?? 1000);
  const telemetry = opts.telemetry ?? noopTelemetry;
  const mountPath = opts.mountPath ?? '/api/v1';

  const router = makeRouter({ repo, cache, queue, limiter, telemetry, coachingLLM: opts.coachingLLM });
  const app = express()
    .use(express.json())
    .use(mountPath, authMiddleware(opts.auth ?? 'header'), router);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    apiBase: `${base}${mountPath}`,
    repo,
    cache,
    queue,
    limiter,
    telemetry,
    router,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Setup/teardown wrapper: boots the app, runs `fn`, and always closes the server.
 * Mirrors the per-file withServer() pattern the route tests already use.
 */
export async function withTestApp<R extends Repository = InMemoryRepository>(
  opts: TestAppOptions<R>,
  fn: (app: TestApp<R>) => Promise<void>,
): Promise<void> {
  const app = await makeTestApp(opts);
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}
