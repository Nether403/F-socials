// Feature: supabase-user-sync, Property 6: Flag idempotency preserved
// Validates: Requirements 3.3
//
// For any valid flag submitted >=2 times (valid Supabase subject, a technique the
// report actually surfaced), exactly one flag is persisted and every submission
// returns the existing success result (201 { ok: true }).
//
// Harness mirrors flag.persist.prop test: a stub middleware sets req.user before
// the router so requireAuth passes, exercising the route's User_Sync + persistence
// + UNIQUE(report_id, user_id, technique) idempotency. The subject is a UUID so the
// route's syncedIdentitySchema trust-boundary check passes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import fc from 'fast-check';
import { makeRouter } from '../src/http/routes';
import { InMemoryCache, InMemoryQueue, InMemoryRepository, InMemoryRateLimiter } from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import type { AnalysisReport, FramingSignal } from '../src/types';

// Subject MUST be a UUID to clear syncedIdentitySchema (Req 8.2).
const SUBJECT = randomUUID();
const USER = { id: SUBJECT, email: 'u@x.test', role: 'authenticated' as const };
const TECHNIQUES = ['Emotional Language', 'Us vs Them', 'Fearmongering', 'Loaded Language'];
const REPORT_ID = 'report-flag-idempotent';

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

test('Property 6: a valid flag submitted >=2 times persists exactly one flag, every response 201 { ok: true }', async () => {
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const queue = new InMemoryQueue();
  const limiter = new InMemoryRateLimiter(1000);
  await repo.saveReport(seededReport());

  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.user = USER;
    next();
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v1', authStub, makeRouter({ repo, cache, queue, limiter, telemetry: noopTelemetry }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/v1/analyses/${REPORT_ID}/flags`;

  try {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...TECHNIQUES),
        fc.integer({ min: 2, max: 6 }), // N >= 2 submissions of the same flag
        fc.option(fc.string(), { nil: undefined }),
        async (technique, n, note) => {
          // Fresh flag table per run so "exactly one" is meaningful for THIS flag.
          repo.flags.length = 0;

          for (let i = 0; i < n; i++) {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(note === undefined ? { technique } : { technique, note }),
            });
            // Every submission returns the existing success result, unchanged.
            assert.equal(res.status, 201);
            assert.deepEqual(await res.json(), { ok: true });
          }

          // Exactly one flag persisted for this report/user/technique, despite N submits.
          const matching = repo.flags.filter(
            (f) => f.reportId === REPORT_ID && f.userId === SUBJECT && f.technique === technique,
          );
          assert.equal(matching.length, 1);
          // And no stray rows under any other key.
          assert.equal(repo.flags.length, 1);
        },
      ),
      { numRuns: 100 },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
