// Feature: trust-and-launch-bundle, Property 6: An authenticated flag with a
// matching technique is persisted to the user (Requirements 3.3, 3.5).
//
// We mount a tiny middleware that sets req.user before the router, simulating an
// authenticated caller without JWT plumbing. requireAuth then passes, so this
// exercises the route's persistence + technique-matching logic — which is exactly
// what Property 6 covers (an authenticated, technique-matched flag is persisted
// and bound to the report + user).

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import fc from 'fast-check';
import { makeRouter } from '../src/http/routes';
import { InMemoryCache, InMemoryQueue, InMemoryRepository, InMemoryRateLimiter } from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import type { AnalysisReport, FramingSignal } from '../src/types';

const USER = { id: 'user-1', email: 'u@x.test', role: 'authenticated' as const };
const TECHNIQUES = ['Emotional Language', 'Us vs Them', 'Fearmongering', 'Loaded Language'];
const REPORT_ID = 'report-under-test';

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

test('authenticated, technique-matched flag is persisted to the report and user', async () => {
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
      fc.asyncProperty(fc.constantFrom(...TECHNIQUES), async (technique) => {
        // Fresh flag table per run so "exactly one" is meaningful.
        repo.flags.length = 0;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ technique }),
        });

        assert.equal(res.status, 201);
        assert.equal(repo.flags.length, 1);
        const flag = repo.flags[0]!; // length asserted to be 1 above
        assert.equal(flag.reportId, REPORT_ID);
        assert.equal(flag.userId, USER.id);
        assert.equal(flag.technique, technique);
      }),
      { numRuns: 100 },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
