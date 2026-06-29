// Feature: institutional-workspace, Property 1: Authorization follows membership and role
// Validates: Requirements 2.2, 3.3, 5.3, 5.6, 6.7, 7.8, 8.2, 8.3, 8.5
//
// Drives the `loadMembership` authorization decision through the real workspace
// routes (makeRouter + InMemoryRepository over an ephemeral HTTP server) against
// generated membership/role states, asserting every route's status code matches a
// pure membership+role oracle:
//   - a request targeting a non-existent workspace            -> 404 (Req 8.7)
//   - an existing workspace where the requester is no member  -> 403 (Req 8.2, 8.5)
//   - an owner-only operation requested by a 'member' reader  -> 403 (Req 2.2, 3.3, 5.6)
//   - a member-scoped op by any member, or an owner-only op by
//     the owner                                               -> allowed (Req 5.3, 6.7, 7.8)
// The decision depends ONLY on membership + role (Req 8.3, 8.5): the same reader/route
// pair yields the same outcome regardless of the rest of the generated state.
//
// Auth seam mirrors the sibling route tests (savedReports.routes / review.authz): a
// tiny middleware sets req.user from an `x-test-reader` header so a single booted app
// can issue requests as many different readers — isolating the membership/role logic
// from JWT verification (which the protectedRoutes/unauth tests already cover).

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import fc from 'fast-check';
import express, { type NextFunction, type Request, type Response } from 'express';

import { makeRouter } from '../src/http/routes';
import {
  InMemoryCache,
  InMemoryQueue,
  InMemoryRateLimiter,
  InMemoryRepository,
} from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';

// Fixed, distinct identities. Owner is never equal to OTHER (the member-removal
// target) so the owner-self-removal 400 guard (Req 3.4) never masks the authz
// decision. GHOST is a reader that is never granted any membership, guaranteeing the
// non-member 403 branch is exercised every run even when no random non-members exist.
const OWNER = 'owner-reader';
const OTHER = 'target-reader';
const GHOST = 'ghost-reader';

// Valid UUIDs for the routes whose :cid / :reportId / :aid params are UUID-validated
// BEFORE loadMembership runs — so a malformed-id 400 never pre-empts the authz check.
const CID = '11111111-1111-4111-8111-111111111111';
const RID = '22222222-2222-4222-8222-222222222222';
// A workspace id guaranteed never to be created (createWorkspace uses randomUUID()).
const NONEXISTENT_WS = '33333333-3333-4333-8333-333333333333';

type Rel = 'owner' | 'member' | 'nonmember';

interface RouteDesc {
  readonly name: string;
  readonly ownerOnly: boolean;
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: (wsId: string) => string;
  readonly body?: unknown;
}

// Every workspace-scoped route that runs through loadMembership. The member-scoped
// routes chosen here reach a 200/201 on the authorized path WITHOUT depending on
// report existence (GET members/collections/items/annotations, POST collection with a
// valid name), so "allowed" is observable as a 2xx. Owner-only routes (invites, member
// removal, collection delete) reach a 200 for the owner on an idempotent/no-op target.
const ROUTES: readonly RouteDesc[] = [
  { name: 'GET members', ownerOnly: false, method: 'GET', path: (w) => `/workspaces/${w}/members` },
  { name: 'GET collections', ownerOnly: false, method: 'GET', path: (w) => `/workspaces/${w}/collections` },
  { name: 'POST collections', ownerOnly: false, method: 'POST', path: (w) => `/workspaces/${w}/collections`, body: { name: 'Topic' } },
  { name: 'GET collection items', ownerOnly: false, method: 'GET', path: (w) => `/workspaces/${w}/collections/${CID}/items` }, // Req 6.7
  { name: 'GET annotations', ownerOnly: false, method: 'GET', path: (w) => `/workspaces/${w}/reports/${RID}/annotations` }, // Req 7.8
  { name: 'POST invites', ownerOnly: true, method: 'POST', path: (w) => `/workspaces/${w}/invites` }, // Req 2.2
  { name: 'DELETE member', ownerOnly: true, method: 'DELETE', path: (w) => `/workspaces/${w}/members/${OTHER}` }, // Req 3.3
  { name: 'DELETE collection', ownerOnly: true, method: 'DELETE', path: (w) => `/workspaces/${w}/collections/${CID}` }, // Req 5.6
];

// The pure oracle: the expected outcome class for (relationship, route) — a function
// of membership + role ONLY (Req 8.3, 8.5).
type Outcome = 'allowed' | 'forbidden';
function oracle(rel: Rel, ownerOnly: boolean): Outcome {
  if (rel === 'nonmember') return 'forbidden'; // Req 8.2, 8.5
  if (ownerOnly && rel === 'member') return 'forbidden'; // Req 2.2, 3.3, 5.6
  return 'allowed'; // member-scoped by any member, or owner-only by the owner (Req 5.3, 6.7, 7.8)
}

function buildApp(): { app: express.Express; repo: InMemoryRepository } {
  const repo = new InMemoryRepository();
  const auth = (req: Request, _res: Response, next: NextFunction): void => {
    const reader = req.header('x-test-reader');
    if (reader) req.user = { id: reader, role: 'authenticated' };
    next();
  };
  const app = express()
    .use(express.json())
    .use(
      '/api/v1',
      auth,
      makeRouter({
        repo,
        cache: new InMemoryCache(),
        queue: new InMemoryQueue(),
        limiter: new InMemoryRateLimiter(100000),
        telemetry: noopTelemetry,
      }),
    );
  return { app, repo };
}

async function withServer(
  fn: (base: string, repo: InMemoryRepository) => Promise<void>,
): Promise<void> {
  const { app, repo } = buildApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}/api/v1`, repo);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function call(base: string, reader: string, route: RouteDesc, wsId: string): Promise<number> {
  const init: RequestInit = {
    method: route.method,
    headers: {
      'x-test-reader': reader,
      ...(route.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(route.body !== undefined ? { body: JSON.stringify(route.body) } : {}),
  };
  const res = await fetch(`${base}${route.path(wsId)}`, init);
  // Drain the body so the socket is released promptly under high run counts.
  await res.text();
  return res.status;
}

// A unique reader-id generator that never collides with the fixed OWNER/OTHER/GHOST.
const readerArb = fc.uuid().map((u) => `reader:${u}`);

test('Property 1: authorization follows membership and role across every workspace route', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(readerArb, { minLength: 0, maxLength: 4 }),
      fc.uniqueArray(readerArb, { minLength: 0, maxLength: 4 }),
      async (memberIds, nonMemberIds) => {
        // Disjoint member / non-member id sets (uuids are unique by construction
        // across the two arrays only probabilistically — enforce it explicitly).
        const members = memberIds.filter((m) => !nonMemberIds.includes(m));

        await withServer(async (base, repo) => {
          // --- Build the generated membership/role state -----------------------
          const ws = await repo.createWorkspace(OWNER, 'Workspace'); // OWNER -> role 'owner'
          for (const m of members) {
            const code = await repo.createInvite(ws.id);
            const redeemed = await repo.redeemInvite(code, m); // m -> role 'member'
            assert.equal(redeemed?.role, 'member');
          }
          assert.notEqual(ws.id, NONEXISTENT_WS);

          // Requesters covering each relationship class. GHOST and the random
          // non-members are non-members; members are members; OWNER is the owner.
          const requesters: ReadonlyArray<{ id: string; rel: Rel }> = [
            { id: OWNER, rel: 'owner' },
            ...members.map((id) => ({ id, rel: 'member' as const })),
            { id: GHOST, rel: 'nonmember' as const },
            ...nonMemberIds
              .filter((n) => !members.includes(n))
              .map((id) => ({ id, rel: 'nonmember' as const })),
          ];

          // --- Existing workspace: status matches the membership+role oracle ----
          for (const { id, rel } of requesters) {
            for (const route of ROUTES) {
              const status = await call(base, id, route, ws.id);
              const expected = oracle(rel, route.ownerOnly);
              if (expected === 'forbidden') {
                assert.equal(
                  status,
                  403,
                  `${route.name} by ${rel} should be 403, got ${status}`,
                );
              } else {
                assert.ok(
                  status === 200 || status === 201,
                  `${route.name} by ${rel} should be allowed (2xx), got ${status}`,
                );
              }
            }
          }

          // --- Non-existent workspace: every route 404 regardless of requester --
          // (Req 8.7 — workspace existence is checked before the membership read.)
          for (const id of [OWNER, GHOST]) {
            for (const route of ROUTES) {
              const status = await call(base, id, route, NONEXISTENT_WS);
              assert.equal(
                status,
                404,
                `${route.name} on a non-existent workspace should be 404, got ${status}`,
              );
            }
          }
        });
      },
    ),
    { numRuns: 100 },
  );
});
