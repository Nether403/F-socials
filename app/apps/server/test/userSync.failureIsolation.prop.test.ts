// Feature: supabase-user-sync, Property 8: Sync-failure isolation
// Validates: Requirements 6.1, 6.2, 6.3
//
// For any otherwise-valid flag (valid UUID subject, optional valid email/role,
// naming a technique the report actually surfaced), when ensureLocalUser fails,
// the flag route must:
//   - respond 500 with body { error: 'sync_failed' } (Req 6.1),
//   - persist NO flag for that submission (Req 6.2),
//   - persist NO Local_User for the subject (getLocalUser undefined) (Req 6.3),
//   - leave all previously persisted data in its pre-action state (Req 6.3).
//
// Harness: a failing-repo stub that EXTENDS InMemoryRepository and overrides only
// ensureLocalUser to throw. Everything else (saveReport, createFlag, getLocalUser)
// behaves exactly as the real in-memory driver, so the route reaches the sync step
// with a valid identity and a surfaced technique — the throw is the only failure.
// req.user is injected by a tiny auth stub (no JWT plumbing), the same pattern the
// existing flag.persist / flag.unauth route tests use.

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
const REPORT_ID = 'report-failure-isolation';

// Pre-existing data that MUST survive a failed sync untouched (Req 6.3).
const PRIOR_FLAG = {
  id: 'prior-flag-1',
  reportId: REPORT_ID,
  userId: '11111111-1111-1111-1111-111111111111',
  technique: 'Fearmongering',
  note: 'seeded before the failing action',
  createdAt: '2020-01-01T00:00:00.000Z',
};

// A repo whose User_Sync always fails, otherwise identical to the in-memory driver.
class FailingSyncRepository extends InMemoryRepository {
  override async ensureLocalUser(): Promise<void> {
    throw new Error('sync boom — backing store unavailable');
  }
}

// Alphanumeric local/domain parts => always a zod-valid address, so the email
// claim never trips identity validation (Req 8.4). Keeps the flag "otherwise
// valid" so the ONLY failure is the throwing ensureLocalUser.
const alnum = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 12 })
  .map((cs) => cs.join(''));
const validEmail = fc.tuple(alnum, alnum).map(([local, domain]) => `${local}@${domain}.com`);

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
    contentId: 'content-1',
    urlHash: 'hash-1',
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

test('Property 8: a sync failure yields 500 sync_failed, persists no flag/user, and leaves prior data unchanged', async () => {
  const repo = new FailingSyncRepository();
  await repo.saveReport(seededReport());

  // Mutable identity the auth stub injects per request (fast-check varies it).
  let currentUser: { id: string; email?: string; role?: string } = { id: PRIOR_FLAG.userId };
  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.user = currentUser;
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
      fc.asyncProperty(
        fc.uuid(), // valid subject — passes syncedIdentitySchema (Req 8.2)
        fc.constantFrom(...TECHNIQUES), // a technique the report surfaced
        fc.option(validEmail, { nil: undefined }),
        fc.option(fc.string({ minLength: 1, maxLength: 64 }), { nil: undefined }), // role
        fc.option(fc.string({ maxLength: 200 }), { nil: undefined }), // note
        async (subject, technique, email, role, note) => {
          // Reset to the pre-action baseline: exactly the one prior flag, no users.
          repo.flags.length = 0;
          await repo.createFlag({ ...PRIOR_FLAG }); // createFlag is the real in-memory impl

          currentUser = {
            id: subject,
            ...(email !== undefined ? { email } : {}),
            ...(role !== undefined ? { role } : {}),
          };

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(note !== undefined ? { technique, note } : { technique }),
          });

          // Req 6.1 — server error, generic body, no internals leaked.
          assert.equal(res.status, 500);
          const json = (await res.json()) as { error?: string };
          assert.deepEqual(json, { error: 'sync_failed' });

          // Req 6.2 + 6.3 — no Local_User persisted for the subject.
          assert.equal(await repo.getLocalUser(subject), undefined);

          // Req 6.2 — no flag persisted for this submission; only the prior flag remains.
          assert.equal(repo.flags.length, 1);

          // Req 6.3 — the prior flag is byte-for-byte unchanged.
          const survivor = repo.flags[0]!;
          assert.equal(survivor.id, PRIOR_FLAG.id);
          assert.equal(survivor.reportId, PRIOR_FLAG.reportId);
          assert.equal(survivor.userId, PRIOR_FLAG.userId);
          assert.equal(survivor.technique, PRIOR_FLAG.technique);
          assert.equal(survivor.note, PRIOR_FLAG.note);
          assert.equal(survivor.createdAt, PRIOR_FLAG.createdAt);
        },
      ),
      { numRuns: 100 },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
