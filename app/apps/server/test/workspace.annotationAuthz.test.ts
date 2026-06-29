// Feature: institutional-workspace, Property 2: Annotation edit/delete authorization is author-or-owner
// Validates: Requirements 7.3, 7.4, 7.5
//
// PATCH (edit) and DELETE on an annotation are authorized (200) IFF the requesting
// reader is the annotation's author OR holds the Owner Role in the annotation's
// workspace; otherwise the API responds 403 and the annotation is left unchanged
// (text preserved for edit; still present for delete). A non-member requester is
// also denied — loadMembership runs first, so a non-member is rejected at the
// membership gate — and either way the annotation is unchanged.
//
// Harness mirrors the sibling route tests (savedReports.routes.test.ts,
// review.authz.test.ts, protectedRoutes.test.ts): an express app built from
// makeRouter + InMemoryRepository, with a tiny stub middleware setting req.user so
// requireAuth passes and the route's authorization logic is what's exercised. The
// stub reads a mutable holder so a single server can serve every generated reader.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import fc from 'fast-check';
import { makeRouter } from '../src/http/routes';
import {
  InMemoryCache,
  InMemoryQueue,
  InMemoryRateLimiter,
  InMemoryRepository,
} from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import type { AnalysisReport } from '../src/types';

// Mutable current-reader holder: the auth stub reads this so one server can answer
// requests as any generated reader without rebuilding the router.
const current = { readerId: 'unset' };

function buildApp() {
  const repo = new InMemoryRepository();
  const auth = (req: Request, _res: Response, next: NextFunction): void => {
    req.user = { id: current.readerId, role: 'authenticated' };
    next();
  };
  const app = express()
    .use(express.json())
    .use('/api/v1', auth, makeRouter({
      repo,
      cache: new InMemoryCache(),
      queue: new InMemoryQueue(),
      limiter: new InMemoryRateLimiter(1_000_000),
      telemetry: noopTelemetry,
    }));
  return { app, repo };
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

type RequesterKind = 'owner' | 'author' | 'otherMember' | 'nonMember';

const scenario = fc.record({
  memberCount: fc.integer({ min: 0, max: 4 }),
  authorIsOwner: fc.boolean(),
  authorSeed: fc.integer({ min: 0, max: 100 }),
  requesterKind: fc.constantFrom<RequesterKind>('owner', 'author', 'otherMember', 'nonMember'),
  op: fc.constantFrom<'edit' | 'delete'>('edit', 'delete'),
  originalText: fc.string({ minLength: 1, maxLength: 60 }),
  newText: fc.string({ minLength: 1, maxLength: 60 }),
});

test('annotation edit/delete is authorized iff author-or-owner, else 403 and unchanged', async () => {
  const { app, repo } = buildApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/v1`;

  try {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        // Unique identities per run so runs sharing the one repo never interfere.
        const runId = randomUUID();
        const owner = `owner-${runId}`;
        const members = Array.from({ length: s.memberCount }, (_, i) => `member-${i}-${runId}`);
        const outsider = `outsider-${runId}`;

        // The author is some member (or the owner). With no members it must be the owner.
        const author =
          s.authorIsOwner || members.length === 0
            ? owner
            : members[s.authorSeed % members.length]!;

        // Resolve the requesting reader R from an arbitrary role state.
        const resolveR = (kind: RequesterKind): string => {
          switch (kind) {
            case 'owner':
              return owner;
            case 'author':
              return author;
            case 'otherMember':
              return members.find((m) => m !== author) ?? outsider; // fall back to a non-member
            case 'nonMember':
              return outsider;
          }
        };
        const R = resolveR(s.requesterKind);

        // The property under test: authorized IFF R is the author or the workspace owner.
        const expectedAuthorized = R === author || R === owner;

        // --- setup: workspace (owner A), members join via invite, report, annotation ---
        const ws = await repo.createWorkspace(owner, `ws-${runId}`);
        for (const m of members) {
          const code = await repo.createInvite(ws.id);
          await repo.redeemInvite(code, m);
        }
        const reportId = randomUUID();
        await seedReport(repo, reportId);
        const ann = await repo.createAnnotation({
          workspaceId: ws.id,
          reportId,
          authorId: author,
          text: s.originalText,
        });

        // --- act as reader R ---
        current.readerId = R;
        const url = `${base}/workspaces/${ws.id}/annotations/${ann.id}`;

        if (s.op === 'edit') {
          const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: s.newText }),
          });
          const after = await repo.getAnnotation(ann.id);
          if (expectedAuthorized) {
            assert.equal(res.status, 200, 'author/owner edit must be authorized'); // Req 7.3
            assert.equal(after?.text, s.newText, 'authorized edit updates the text');
          } else {
            assert.equal(res.status, 403, 'non author/owner edit must be forbidden'); // Req 7.4
            assert.equal(after?.text, s.originalText, 'denied edit leaves the text unchanged'); // Req 7.4
          }
        } else {
          const res = await fetch(url, { method: 'DELETE' });
          const after = await repo.getAnnotation(ann.id);
          if (expectedAuthorized) {
            assert.equal(res.status, 200, 'author/owner delete must be authorized'); // Req 7.5
            assert.equal(after, undefined, 'authorized delete removes the annotation');
          } else {
            assert.equal(res.status, 403, 'non author/owner delete must be forbidden'); // Req 7.4
            assert.ok(
              after !== undefined && after.text === s.originalText,
              'denied delete leaves the annotation present and unchanged', // Req 7.4
            );
          }
        }
      }),
      { numRuns: 150 },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
