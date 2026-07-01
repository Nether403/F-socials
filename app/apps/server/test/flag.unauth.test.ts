// Feature: trust-and-launch-bundle, Property 7: Unauthenticated flag submissions
// are rejected and never persisted. For any flag request body submitted without a
// valid Authorization header, POST /api/v1/analyses/:id/flags responds 401
// (auth_required) and no flag is ever persisted.
// Validates: Requirements 3.4
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { withTestApp } from './helpers/makeTestApp';
import type { Repository } from '../src/infra/ports';
import type { AnalysisReport } from '../src/types';

// A ready report carrying real framing techniques, so a "valid-looking" technique
// can't be the reason for rejection — only the missing auth can be.
function seedReport(repo: Repository): AnalysisReport {
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
  await withTestApp({ auth: 'real', rateLimit: 100 }, async (app) => {
    const repo = app.repo;
    const report = seedReport(repo);

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
          const res = await fetch(`${app.apiBase}/analyses/${report.id}/flags`, {
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
  });
});
