// Feature: trust-and-launch-bundle, Property 5: A valid anonymous dispute is
// persisted without a user identity.
// For ANY reason of length 1..2000 POSTed (without auth) to an existing report's
// dispute endpoint, the API responds 201 and persists exactly one dispute that
// carries no user identity, bound to the targeted report.
// Validates: Requirements 3.1, 3.2

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { withTestApp } from './helpers/makeTestApp';
import type { Repository } from '../src/infra/ports';
import type { AnalysisReport } from '../src/types';

const REPORT_ID = 'report-under-test';

function seedReport(repo: Repository): Promise<void> {
  const now = new Date().toISOString();
  const report: AnalysisReport = {
    id: REPORT_ID,
    contentId: 'content-1',
    urlHash: 'hash-1',
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

// Single-code-unit ASCII alphabet so the generated string's `.length` (what the
// zod .min(1).max(2000) check counts) is exactly the requested 1..2000 — no
// surrogate-pair surprises that would falsely trip the 2000-char ceiling.
const reasonArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABC 0123456789.,!?'.split('')), {
    minLength: 1,
    maxLength: 2000,
  })
  .map((chars) => chars.join(''));

test('Property 5: a valid anonymous dispute is persisted with no user identity', async () => {
  await withTestApp({ auth: 'real' }, async (app) => {
    const repo = app.repo;
    await seedReport(repo);
    const url = `${app.apiBase}/analyses/${REPORT_ID}/disputes`;

    await fc.assert(
      fc.asyncProperty(reasonArb, async (reason) => {
        // Fresh dispute log each run so "exactly one" is meaningful.
        repo.disputes.length = 0;

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason }),
        });

        // 3.1: success status for a valid anonymous dispute.
        assert.equal(res.status, 201);

        // 3.1/3.2: exactly one dispute persisted, bound to the report, with no
        // user identity attached (the record shape has no user field at all).
        assert.equal(repo.disputes.length, 1);
        const persisted = repo.disputes[0]!; // length asserted to be 1 above
        assert.equal(persisted.reportId, REPORT_ID);
        assert.equal(persisted.reason, reason);
        assert.ok(!('userId' in persisted), 'anonymous dispute must carry no user identity');
        assert.ok(!('raisedBy' in persisted), 'anonymous dispute must carry no user identity');
      }),
      { numRuns: 100 },
    );
  });
});
