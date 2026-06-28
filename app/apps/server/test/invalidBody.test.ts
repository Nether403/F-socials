// Feature: trust-and-launch-bundle, Property 9: Invalid dispute/flag bodies are
// rejected and never persisted.
//
// For any dispute reason that is empty or exceeds 2000 chars, and for any flag
// technique that does not match a framing technique in the referenced report, the
// API responds with a validation-error status (400) and persists nothing.
//
// Validates: Requirements 3.7
//
// The report exists (so 404 is not the cause) and an auth-stub sets req.user (so
// 401 is not the cause for the flag route) — the only remaining failure surface is
// body/technique validation.

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import fc from 'fast-check';

import { makeRouter } from '../src/http/routes';
import { InMemoryCache, InMemoryQueue, InMemoryRateLimiter, InMemoryRepository } from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import type { AnalysisReport } from '../src/types';

const REPORT_ID = 'report-1';
// The known framing-technique set seeded on the report. A flag whose technique is
// outside this set must be rejected.
const KNOWN_TECHNIQUES = ['Emotional Language', 'Us vs. Them Framing'];

function seedReport(repo: InMemoryRepository): Promise<void> {
  const now = new Date().toISOString();
  const report: AnalysisReport = {
    id: REPORT_ID,
    contentId: 'content-1',
    urlHash: 'hash-1',
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    tldr: 'summary',
    claims: [],
    framingSignals: KNOWN_TECHNIQUES.map((technique) => ({
      technique,
      severity: 'medium' as const,
      description: 'seeded framing signal',
      examples: [{ text: 'quote', explanation: 'why', startIndex: 0, endIndex: 5 }],
    })),
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
  };
  return repo.saveReport(report);
}

function buildApp(repo: InMemoryRepository) {
  const app = express();
  app.use(express.json());
  // Auth stub: pretend every caller is authenticated so the flag route reaches
  // body/technique validation rather than stopping at requireAuth (401).
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', role: 'authenticated' };
    next();
  });
  app.use(
    '/api/v1',
    makeRouter({
      repo,
      cache: new InMemoryCache(),
      queue: new InMemoryQueue(),
      limiter: new InMemoryRateLimiter(1_000_000),
      telemetry: noopTelemetry,
    }),
  );
  return app;
}

// Invalid dispute reasons: empty string OR a string longer than 2000 chars.
const invalidReasonArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 2001, maxLength: 2100 }),
);

// Techniques that do NOT match a framing technique in the report. Includes
// arbitrary non-matching strings (-> invalid_technique) plus empty/over-long
// values (-> schema invalid_input). Either way the response is 400.
const invalidTechniqueArb = fc
  .oneof(
    fc.string(),
    fc.constant(''),
    fc.string({ minLength: 201, maxLength: 260 }),
  )
  .filter((t) => !KNOWN_TECHNIQUES.includes(t));

test('Property 9: invalid dispute/flag bodies are rejected (400) and never persisted', async () => {
  const repo = new InMemoryRepository();
  await seedReport(repo);
  const server = buildApp(repo).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  try {
    // Property A — invalid dispute reasons (3.7): empty or > 2000 chars -> 400, no dispute persisted.
    await fc.assert(
      fc.asyncProperty(invalidReasonArb, async (reason) => {
        const res = await fetch(`${base}/analyses/${REPORT_ID}/disputes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason }),
        });
        assert.equal(res.status, 400, `expected 400 for reason length ${reason.length}`);
        assert.equal(repo.disputes.length, 0, 'no dispute may be persisted on invalid input');
      }),
      { numRuns: 100 },
    );

    // Property B — invalid flag techniques (3.7): technique not in the report's
    // framing set -> 400, no flag persisted.
    await fc.assert(
      fc.asyncProperty(invalidTechniqueArb, async (technique) => {
        const res = await fetch(`${base}/analyses/${REPORT_ID}/flags`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ technique }),
        });
        assert.equal(res.status, 400, `expected 400 for technique ${JSON.stringify(technique)}`);
        assert.equal(repo.flags.length, 0, 'no flag may be persisted on invalid input');
      }),
      { numRuns: 100 },
    );

    // Final guard: nothing persisted across all runs.
    assert.equal(repo.disputes.length, 0);
    assert.equal(repo.flags.length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
