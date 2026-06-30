// Feature: supabase-user-sync, Property 5: Flag resolves to the synced user
// Validates: Requirements 1.2, 3.1, 3.2, 5.3
//
// For any valid flag submitted by an authenticated subject (with or without an
// email claim, naming a technique the report surfaced), the persisted flag's
// user_id equals the subject and resolves to the Local_User keyed to that
// subject, and the response is the existing flag success result (201 { ok: true }).
//
// We mount a tiny middleware that sets req.user before the router (no JWT
// plumbing), so requireAuth passes and the route exercises its
// validate → ensureLocalUser → createFlag path over the in-memory Repository.

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import fc from 'fast-check';
import { makeRouter } from '../src/http/routes';
import { InMemoryCache, InMemoryQueue, InMemoryRepository, InMemoryRateLimiter } from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import type { AnalysisReport, FramingSignal } from '../src/types';

const TECHNIQUES = ['Emotional Language', 'Us vs Them', 'Fearmongering', 'Loaded Language'];
const REPORT_ID = 'report-flag-resolves';

function signal(technique: string): FramingSignal {
  return {
    technique,
    severity: 'medium',
    description: `Use of ${technique}.`,
    examples: [{ text: 'sample quote', explanation: 'why it is this technique', startIndex: 0, endIndex: 12 }],
  };
}

function seededReport(): AnalysisReport {
  const now = new Date().toISOString();
  return {
    id: REPORT_ID,
    contentId: 'content-flag-resolves',
    urlHash: 'hash-flag-resolves',
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    claims: [],
    framingSignals: TECHNIQUES.map(signal),
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
  };
}

// A valid identity: UUID subject, optional email (present OR absent), optional
// role. Emails are built from constrained parts so they always satisfy the
// trust-boundary zod email validation.
const identityArb = fc.record({
  id: fc.uuid(),
  email: fc.option(
    fc
      .tuple(
        fc.stringMatching(/^[a-z0-9]{1,16}$/),
        fc.stringMatching(/^[a-z0-9]{1,16}$/),
      )
      .map(([local, domain]) => `${local}@${domain}.com`),
    { nil: undefined },
  ),
  role: fc.option(fc.string({ minLength: 1, maxLength: 32 }), { nil: undefined }),
});

test('Property 5: a valid flag persists user_id == subject and resolves to the synced Local_User', async () => {
  const repo = new InMemoryRepository();
  await repo.saveReport(seededReport());

  // Mutable holder so the auth stub can present a different verified identity per run.
  let currentUser: { id: string; email?: string; role?: string };
  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.user = currentUser as Request['user'];
    next();
  };

  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1',
    authStub,
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
  const url = `http://127.0.0.1:${port}/api/v1/analyses/${REPORT_ID}/flags`;

  try {
    await fc.assert(
      fc.asyncProperty(identityArb, fc.constantFrom(...TECHNIQUES), async (identity, technique) => {
        // Fresh flag table per run so "the persisted flag" is unambiguous.
        repo.flags.length = 0;
        currentUser = { id: identity.id, email: identity.email, role: identity.role };

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ technique }),
        });

        // Existing flag success result preserved (Req 3.3, 5.3).
        assert.equal(res.status, 201);
        assert.deepEqual(await res.json(), { ok: true });

        // The persisted flag's user_id equals the subject (Req 3.2).
        assert.equal(repo.flags.length, 1);
        const flag = repo.flags[0]!;
        assert.equal(flag.reportId, REPORT_ID);
        assert.equal(flag.userId, identity.id);
        assert.equal(flag.technique, technique);

        // It resolves to the Local_User keyed to the subject (Req 1.2, 3.1).
        const synced = await repo.getLocalUser(identity.id);
        assert.ok(synced, 'a Local_User keyed to the subject must exist');
        assert.equal(synced.id, identity.id);
        // Email null when the claim omitted it, else the claim value (Req 5.3).
        assert.equal(synced.email, identity.email ?? null);
        assert.equal(synced.role, identity.role ?? 'user');
      }),
      { numRuns: 100 },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
