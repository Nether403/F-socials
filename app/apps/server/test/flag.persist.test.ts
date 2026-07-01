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
import fc from 'fast-check';
import { withTestApp } from './helpers/makeTestApp';
import type { AnalysisReport, FramingSignal } from '../src/types';

// Identity subject must be a valid UUID — the flag route validates req.user.id
// with syncedIdentitySchema (supabase-user-sync Req 8.2) before persisting.
const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'u@x.test', role: 'authenticated' as const };
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
  await withTestApp({ auth: { user: USER } }, async (app) => {
    const repo = app.repo;
    await repo.saveReport(seededReport());
    const url = `${app.apiBase}/analyses/${REPORT_ID}/flags`;

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
  });
});
