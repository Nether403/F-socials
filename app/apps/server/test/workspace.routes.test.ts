// Feature: institutional-workspace — route integration tests for the workspace
// route set (task 5.5). Example/integration tests (not property tests) that drive
// the real router over HTTP against the in-memory infra. Covers:
//   - 401 without a token across the whole route set (requireAuth gate)
//   - 401 when auth is unconfigured (optionalAuth's auth_not_configured branch)
//   - 404 on an unknown workspace; 403 for a non-member and for a member
//     attempting an owner-only op
//   - 400 on malformed body/params (zod boundary)
//   - 404 on redeem-unknown-code and on add/annotate to a missing report
//   - 400 on owner self-removal
//   - 201/200 success shapes across the happy path
//   - an injected failing repo -> 5xx with no partial mutation
//
// Validates: Requirements 1.2, 2.2, 2.4, 3.4, 5.4, 5.6, 6.3, 7.6, 7.7, 8.1, 8.2,
//            8.3, 8.4, 8.6, 8.7, 9.9
//
// Auth seam follows the sibling route tests (savedReports.routes / protectedRoutes):
//   - the 401-no-token set boots the router behind the real optionalAuth gate
//     (no Authorization header -> requireAuth 401), exercising the deployed gate;
//   - the auth-unconfigured case mounts a middleware mirroring optionalAuth's
//     `!secretBytes` branch (Bearer present + no secret -> 401 auth_not_configured),
//     so the test is deterministic regardless of the ambient .env JWT secret;
//   - every other case mounts a tiny header-driven auth stub that sets req.user
//     from an `x-test-user` header (no JWT plumbing), so one app + one repo can act
//     as several identities and the route's validation/membership logic is what's
//     exercised.
//
// Uses only InMemoryRepository (no live database), so this file is registered in
// the MAIN `test` script alongside savedReports.routes.test.ts / protectedRoutes,
// not under `test:integration`.

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

type AuthMode = 'real' | 'unconfigured' | 'header';

// Header-driven auth stub: set req.user from `x-test-user` so one app can act as
// several identities; absent header -> no user -> requireAuth yields 401.
function headerAuth(req: Request, _res: Response, next: NextFunction): void {
  const u = req.header('x-test-user');
  if (u) req.user = { id: u, role: 'authenticated' };
  next();
}

// Mirrors optionalAuth's unconfigured branch exactly: a Bearer header with no JWT
// secret configured -> 401 auth_not_configured; otherwise anonymous (Req 8.6).
function unconfiguredAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }
  res.status(401).json({ error: 'auth_not_configured' });
}

function authFor(mode: AuthMode) {
  if (mode === 'real') return optionalAuth;
  if (mode === 'unconfigured') return unconfiguredAuth;
  return headerAuth;
}

function buildApp(mode: AuthMode, repo: InMemoryRepository = new InMemoryRepository()) {
  const app = express()
    .use(express.json())
    .use(
      '/api/v1',
      authFor(mode),
      makeRouter({
        repo,
        cache: new InMemoryCache(),
        queue: new InMemoryQueue(),
        limiter: new InMemoryRateLimiter(1_000_000),
        telemetry: noopTelemetry,
      }),
    );
  return { app, repo };
}

async function withServer(
  mode: AuthMode,
  fn: (base: string, repo: InMemoryRepository) => Promise<void>,
  repo?: InMemoryRepository,
): Promise<void> {
  const { app, repo: r } = buildApp(mode, repo);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, r);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// One request helper. `user` -> x-test-user header; `body` -> JSON body.
async function call(
  base: string,
  method: string,
  path: string,
  opts: { user?: string; body?: unknown; bearer?: boolean } = {},
): Promise<{ status: number; json: () => Promise<unknown> }> {
  const headers: Record<string, string> = {};
  if (opts.user) headers['x-test-user'] = opts.user;
  if (opts.bearer) headers['authorization'] = 'Bearer dummy.token.value';
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: () => res.json() as Promise<unknown> };
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

// The full workspace route set, with valid-shaped ids so the only thing that can
// fail is the auth gate. Used by the 401-no-token sweep (Req 8.1).
function routeSet() {
  const ws = randomUUID();
  const cid = randomUUID();
  const rid = randomUUID();
  const aid = randomUUID();
  return [
    ['POST', '/workspaces'],
    ['GET', '/workspaces'],
    ['POST', `/workspaces/${ws}/invites`],
    ['POST', `/invites/${randomUUID()}/redeem`],
    ['GET', `/workspaces/${ws}/members`],
    ['DELETE', `/workspaces/${ws}/members/some-reader`],
    ['POST', `/workspaces/${ws}/collections`],
    ['GET', `/workspaces/${ws}/collections`],
    ['DELETE', `/workspaces/${ws}/collections/${cid}`],
    ['POST', `/workspaces/${ws}/collections/${cid}/items`],
    ['GET', `/workspaces/${ws}/collections/${cid}/items`],
    ['DELETE', `/workspaces/${ws}/collections/${cid}/items/${rid}`],
    ['POST', `/workspaces/${ws}/reports/${rid}/annotations`],
    ['GET', `/workspaces/${ws}/reports/${rid}/annotations`],
    ['PATCH', `/workspaces/${ws}/annotations/${aid}`],
    ['DELETE', `/workspaces/${ws}/annotations/${aid}`],
  ] as const;
}

// --- 401 without a token across the whole route set (Req 8.1) ----------------

test('every workspace route rejects an unauthenticated request with 401', async () => {
  await withServer('real', async (base) => {
    for (const [method, path] of routeSet()) {
      const res = await call(base, method, path);
      assert.equal(res.status, 401, `${method} ${path} should be 401 without a token`);
      assert.equal((await res.json() as { error: string }).error, 'auth_required');
    }
  });
});

// --- 401 when auth is unconfigured (Req 8.6) ---------------------------------

test('a workspace request with auth unconfigured responds 401 and mutates nothing', async () => {
  await withServer('unconfigured', async (base, repo) => {
    const res = await call(base, 'POST', '/workspaces', { bearer: true, body: { name: 'Class A' } });
    assert.equal(res.status, 401);
    assert.equal((await res.json() as { error: string }).error, 'auth_not_configured');
    // No workspace was created for anyone (Req 8.6 — no read/modify of workspace data).
    assert.deepEqual(await repo.listWorkspacesForReader('anyone'), []);
  });
});

// --- 404 on an unknown workspace (Req 8.7) -----------------------------------

test('a workspace-scoped request on an unknown workspace responds 404', async () => {
  await withServer('header', async (base) => {
    const res = await call(base, 'GET', `/workspaces/${randomUUID()}/members`, { user: 'reader-1' });
    assert.equal(res.status, 404);
    assert.equal((await res.json() as { error: string }).error, 'not_found');
  });
});

// --- 403 for a non-member (Req 8.2) ------------------------------------------

test('a non-member request on an existing workspace responds 403', async () => {
  await withServer('header', async (base, repo) => {
    const ws = await repo.createWorkspace('owner-A', 'Owner workspace');
    const res = await call(base, 'GET', `/workspaces/${ws.id}/members`, { user: 'outsider-B' });
    assert.equal(res.status, 403);
    assert.equal((await res.json() as { error: string }).error, 'forbidden');
  });
});

// --- 403 for a member attempting an owner-only op (Req 8.3, 2.2) -------------

test('a member attempting an owner-only op responds 403 and changes nothing', async () => {
  await withServer('header', async (base, repo) => {
    const ws = await repo.createWorkspace('owner-A', 'Owner workspace');
    const code = await repo.createInvite(ws.id);
    await repo.redeemInvite(code, 'member-B'); // member-B now holds the Member Role

    // Owner-only: issue an invite (Req 2.2).
    const inviteRes = await call(base, 'POST', `/workspaces/${ws.id}/invites`, { user: 'member-B' });
    assert.equal(inviteRes.status, 403);
    assert.equal((await inviteRes.json() as { error: string }).error, 'forbidden');

    // Owner-only: remove a member (Req 3.3) — still 403 for a member.
    const removeRes = await call(base, 'DELETE', `/workspaces/${ws.id}/members/owner-A`, { user: 'member-B' });
    assert.equal(removeRes.status, 403);
    // The owner Membership is untouched.
    const members = await repo.listMembers(ws.id);
    assert.ok(members.some((m) => m.readerId === 'owner-A' && m.role === 'owner'));
  });
});

// --- 400 on malformed body/params (Req 8.4, 1.4, 5.4) ------------------------

test('malformed workspace bodies and params are rejected with 400', async () => {
  await withServer('header', async (base, repo) => {
    const ws = await repo.createWorkspace('reader-1', 'WS');

    // Empty workspace name (Req 1.4).
    const emptyName = await call(base, 'POST', '/workspaces', { user: 'reader-1', body: { name: '' } });
    assert.equal(emptyName.status, 400);
    assert.equal((await emptyName.json() as { error: string }).error, 'invalid_input');

    // Over-long collection name (Req 5.4).
    const longName = await call(base, 'POST', `/workspaces/${ws.id}/collections`, {
      user: 'reader-1',
      body: { name: 'x'.repeat(101) },
    });
    assert.equal(longName.status, 400);

    // Non-UUID :cid path param (Req 8.4) — parsed before the membership check.
    const badCid = await call(base, 'DELETE', `/workspaces/${ws.id}/collections/not-a-uuid`, { user: 'reader-1' });
    assert.equal(badCid.status, 400);
    assert.equal((await badCid.json() as { error: string }).error, 'invalid_id');

    // Non-UUID reportId in a collection-item body (Req 8.4).
    const badItem = await call(base, 'POST', `/workspaces/${ws.id}/collections/${randomUUID()}/items`, {
      user: 'reader-1',
      body: { reportId: 'nope' },
    });
    assert.equal(badItem.status, 400);
    assert.equal((await badItem.json() as { error: string }).error, 'invalid_input');
  });
});

// --- 404 on redeem-unknown-code (Req 2.4) ------------------------------------

test('redeeming a code that matches no workspace responds 404 and creates no membership', async () => {
  await withServer('header', async (base, repo) => {
    const res = await call(base, 'POST', `/invites/${randomUUID()}/redeem`, { user: 'reader-1' });
    assert.equal(res.status, 404);
    assert.equal((await res.json() as { error: string }).error, 'not_found');
    assert.deepEqual(await repo.listWorkspacesForReader('reader-1'), []);
  });
});

// --- 404 on add/annotate to a missing report (Req 6.3, 7.7) ------------------

test('adding or annotating a missing report responds 404 and persists nothing', async () => {
  await withServer('header', async (base, repo) => {
    const ws = await repo.createWorkspace('reader-1', 'WS');
    const collection = await repo.createCollection(ws.id, 'C1');
    const missingReport = randomUUID(); // valid UUID, never seeded

    // add a missing report to a collection (Req 6.3).
    const addRes = await call(base, 'POST', `/workspaces/${ws.id}/collections/${collection.id}/items`, {
      user: 'reader-1',
      body: { reportId: missingReport },
    });
    assert.equal(addRes.status, 404);
    assert.equal((await addRes.json() as { error: string }).error, 'not_found');
    assert.deepEqual(await repo.listCollectionItems(collection.id), []);

    // annotate a missing report (Req 7.7).
    const annRes = await call(base, 'POST', `/workspaces/${ws.id}/reports/${missingReport}/annotations`, {
      user: 'reader-1',
      body: { text: 'a note' },
    });
    assert.equal(annRes.status, 404);
    assert.equal((await annRes.json() as { error: string }).error, 'not_found');
    assert.deepEqual(await repo.listAnnotations(ws.id, missingReport), []);
  });
});

// --- 400 on owner self-removal (Req 3.4) -------------------------------------

test('owner self-removal responds 400 and leaves the owner Membership unchanged', async () => {
  await withServer('header', async (base, repo) => {
    const ws = await repo.createWorkspace('owner-A', 'WS');
    const res = await call(base, 'DELETE', `/workspaces/${ws.id}/members/owner-A`, { user: 'owner-A' });
    assert.equal(res.status, 400);
    assert.equal((await res.json() as { error: string }).error, 'cannot_remove_self');
    const members = await repo.listMembers(ws.id);
    assert.ok(members.some((m) => m.readerId === 'owner-A' && m.role === 'owner'));
  });
});

// --- 201/200 success shapes across the happy path (Req 1.2 et al.) -----------

test('the workspace happy path returns the documented 201/200 success shapes', async () => {
  await withServer('header', async (base, repo) => {
    const owner = 'reader-owner';
    const member = 'reader-member';
    const reportId = randomUUID();
    await seedReport(repo, reportId);

    // POST /workspaces -> 201 { id, name, role: 'owner' } (Req 1.2).
    const createRes = await call(base, 'POST', '/workspaces', { user: owner, body: { name: 'Class A' } });
    assert.equal(createRes.status, 201);
    const ws = (await createRes.json()) as { id: string; name: string; role: string };
    assert.equal(ws.name, 'Class A');
    assert.equal(ws.role, 'owner');
    assert.equal(typeof ws.id, 'string');

    // GET /workspaces -> 200 WorkspaceSummary[] including the new workspace.
    const listRes = await call(base, 'GET', '/workspaces', { user: owner });
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as Array<{ id: string }>;
    assert.ok(list.some((w) => w.id === ws.id));

    // POST invites (owner-only) -> 200 { code }.
    const inviteRes = await call(base, 'POST', `/workspaces/${ws.id}/invites`, { user: owner });
    assert.equal(inviteRes.status, 200);
    const { code } = (await inviteRes.json()) as { code: string };
    assert.equal(typeof code, 'string');

    // POST redeem -> 200 { workspaceId, role: 'member' }.
    const redeemRes = await call(base, 'POST', `/invites/${code}/redeem`, { user: member });
    assert.equal(redeemRes.status, 200);
    assert.deepEqual(await redeemRes.json(), { workspaceId: ws.id, role: 'member' });

    // GET members -> 200 Membership[] with both readers.
    const membersRes = await call(base, 'GET', `/workspaces/${ws.id}/members`, { user: owner });
    assert.equal(membersRes.status, 200);
    const members = (await membersRes.json()) as Array<{ readerId: string; role: string }>;
    assert.equal(members.length, 2);

    // POST collections -> 201 { id, name }.
    const collRes = await call(base, 'POST', `/workspaces/${ws.id}/collections`, { user: member, body: { name: 'Week 1' } });
    assert.equal(collRes.status, 201);
    const collection = (await collRes.json()) as { id: string; name: string };
    assert.equal(collection.name, 'Week 1');

    // GET collections -> 200 SharedCollection[].
    const collListRes = await call(base, 'GET', `/workspaces/${ws.id}/collections`, { user: member });
    assert.equal(collListRes.status, 200);
    assert.equal(((await collListRes.json()) as unknown[]).length, 1);

    // POST collection item -> 200 { ok: true }.
    const addItemRes = await call(base, 'POST', `/workspaces/${ws.id}/collections/${collection.id}/items`, {
      user: member,
      body: { reportId },
    });
    assert.equal(addItemRes.status, 200);
    assert.deepEqual(await addItemRes.json(), { ok: true });

    // GET collection items -> 200 CollectionItemEntry[] with the report.
    const itemsRes = await call(base, 'GET', `/workspaces/${ws.id}/collections/${collection.id}/items`, { user: member });
    assert.equal(itemsRes.status, 200);
    const items = (await itemsRes.json()) as Array<{ reportId: string; addedAt: string }>;
    assert.equal(items.length, 1);
    assert.equal(items[0]!.reportId, reportId);

    // POST annotation -> 201 Annotation (lens-safe shape: no verdict/rating field).
    const annRes = await call(base, 'POST', `/workspaces/${ws.id}/reports/${reportId}/annotations`, {
      user: member,
      body: { text: 'framing note' },
    });
    assert.equal(annRes.status, 201);
    const annotation = (await annRes.json()) as Record<string, unknown> & { id: string };
    assert.equal(annotation.text, 'framing note');
    assert.equal(annotation.authorId, member);
    assert.deepEqual(
      Object.keys(annotation).sort(),
      ['authorId', 'createdAt', 'id', 'reportId', 'text', 'updatedAt', 'workspaceId'],
    );

    // GET annotations -> 200 Annotation[].
    const annListRes = await call(base, 'GET', `/workspaces/${ws.id}/reports/${reportId}/annotations`, { user: member });
    assert.equal(annListRes.status, 200);
    assert.equal(((await annListRes.json()) as unknown[]).length, 1);

    // PATCH annotation (author) -> 200 { ok: true }.
    const patchRes = await call(base, 'PATCH', `/workspaces/${ws.id}/annotations/${annotation.id}`, {
      user: member,
      body: { text: 'edited note' },
    });
    assert.equal(patchRes.status, 200);
    assert.deepEqual(await patchRes.json(), { ok: true });

    // DELETE annotation (author) -> 200 { ok: true }.
    const delAnnRes = await call(base, 'DELETE', `/workspaces/${ws.id}/annotations/${annotation.id}`, { user: member });
    assert.equal(delAnnRes.status, 200);
    assert.deepEqual(await delAnnRes.json(), { ok: true });

    // DELETE collection item -> 200 { ok: true }.
    const delItemRes = await call(base, 'DELETE', `/workspaces/${ws.id}/collections/${collection.id}/items/${reportId}`, { user: member });
    assert.equal(delItemRes.status, 200);
    assert.deepEqual(await delItemRes.json(), { ok: true });

    // DELETE collection (owner-only) -> 200 { ok: true }.
    const delCollRes = await call(base, 'DELETE', `/workspaces/${ws.id}/collections/${collection.id}`, { user: owner });
    assert.equal(delCollRes.status, 200);
    assert.deepEqual(await delCollRes.json(), { ok: true });
  });
});

// --- injected failing repo -> 5xx with no partial mutation (Req 9.9) ---------

test('a backing-store failure surfaces as 5xx and leaves existing data unchanged', async () => {
  const repo = new InMemoryRepository();
  const ws = await repo.createWorkspace('owner-A', 'WS');
  const collection = await repo.createCollection(ws.id, 'C1');
  const reportId = randomUUID();
  await seedReport(repo, reportId);

  // Inject a failing store on a single mutating method (the route reaches it only
  // after auth + membership + validation + report-existence all pass).
  repo.addCollectionItem = async () => {
    throw new Error('backing store unavailable');
  };

  await withServer(
    'header',
    async (base) => {
      const res = await call(base, 'POST', `/workspaces/${ws.id}/collections/${collection.id}/items`, {
        user: 'owner-A',
        body: { reportId },
      });
      assert.ok(res.status >= 500 && res.status < 600, `expected 5xx, got ${res.status}`);
      // No partial mutation: the collection is still empty.
      assert.deepEqual(await repo.listCollectionItems(collection.id), []);
    },
    repo,
  );
});
