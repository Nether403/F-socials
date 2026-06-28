// Feature: trust-and-launch-bundle, Property 7: Unauthenticated flag submissions
// are rejected and never persisted. For any flag request body submitted without a
// valid Authorization header, POST /api/v1/analyses/:id/flags responds 401
// (auth_required) and no flag is ever persisted.
// Validates: Requirements 3.4
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import fc from 'fast-check';
import { makeRouter } from '../src/http/routes';
import { optionalAuth } from '../src/http/auth';
import {
  InMemoryRepository,
  InMemoryCache,
  InMemoryQueue,
  InMemoryRateLimiter,
} from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import type { AnalysisReport } from '../src/types';

// A ready report carrying real framing techniques, so a "valid-looking" technique
// can't be the reason for rejection — only the missing auth can be.
function seedReport(repo: InMemoryRepository): AnalysisReport {
  const now = new Date().toISOString();
  const report: AnalysisReport = {
    id: 'report-prop7',
    contentId: 'content-prop7',
    urlHash: 'hash-prop7',
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    claims: [],
    framingSignals: [
      {
        technique: 'Emotional Language',
        severity: 'medium',
        description: 'Loaded emotive phrasing.',
        examples: [{ text: 'they want to destroy us', explanation: 'fear appeal', startIndex: 0, endIndex: 23 }],
      },
      {
        technique: 'Us vs. Them Framing',
        severity: 'high',
        description: 'In-group/out-group division.',
        examples: [{ text: 'us against them', explanation: 'division', startIndex: 0, endIndex: 15 }],
      },
    ],
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
  };
  repo.saveReport(report);
  return report;
}

test('Property 7: unauthenticated flag submissions are rejected (401) and never persisted', async () => {
  const repo = new InMemoryRepository();
  const report = seedReport(repo);
  const app = express()
    .use(express.json())
    .use(
      '/api/v1',
      optionalAuth,
      makeRouter({
        repo,
        cache: new InMemoryCache(),
        queue: new InMemoryQueue(),
        limiter: new InMemoryRateLimiter(100),
        telemetry: noopTelemetry,
      }),
    );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    await fc.assert(
      fc.asyncProperty(
        // Varied bodies: arbitrary techniques plus the report's real techniques,
        // with/without a note, and some malformed shapes.
        fc.record({
          technique: fc.oneof(
            fc.string(),
            fc.constantFrom('Emotional Language', 'Us vs. Them Framing'),
          ),
          note: fc.option(fc.string(), { nil: undefined }),
        }),
        async (body) => {
          const res = await fetch(`http://127.0.0.1:${port}/api/v1/analyses/${report.id}/flags`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' }, // no Authorization header
            body: JSON.stringify(body),
          });
          assert.equal(res.status, 401);
          const json = (await res.json()) as { error?: string };
          assert.equal(json.error, 'auth_required');
          // Nothing persisted, ever — checked after every single submission.
          assert.equal(repo.flags.length, 0);
        },
      ),
      { numRuns: 100 },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
