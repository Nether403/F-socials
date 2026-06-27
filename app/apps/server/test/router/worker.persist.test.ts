// Feature: claim-verification-router, worker wiring (task 11.2).
// The worker runs the invariant-gate boot guard at construction and persists every
// per-claim AuditRecord after a successful pipeline run, without failing the report
// when a claim has no sufficient evidence.
// Validates: Requirements 6.1, 7.3, 9.2

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorker } from '../../src/pipeline/worker';
import { InMemoryCache, InMemoryRepository } from '../../src/infra/memory';
import {
  mockEvidence,
  mockLLM,
  mockNormalizer,
  mockPerspective,
  mockValidator,
  passthroughTranscript,
} from '../../src/providers/mock';
import type { Providers } from '../../src/providers/types';
import type { AnalysisReport, RawInput } from '../../src/types';
import type { Job } from '../../src/infra/ports';

const providers: Providers = {
  transcript: passthroughTranscript,
  llm: mockLLM,
  evidence: mockEvidence,
  perspective: mockPerspective,
  normalizer: mockNormalizer,
  validator: mockValidator,
};

const meta = { model: 'mock', analysisVersion: 'test', sourcePolicyVersion: 'test' };

function seedReport(repo: InMemoryRepository, id: string): Promise<void> {
  const now = new Date().toISOString();
  const report: AnalysisReport = {
    id,
    contentId: 'content-1',
    urlHash: 'hash-1',
    status: 'queued',
    version: 1,
    producingLayer: 'ai',
    tldr: '',
    claims: [],
    framingSignals: [],
    contextCards: [],
    perspectives: [],
    createdAt: now,
    updatedAt: now,
  };
  return repo.saveReport(report);
}

test('makeWorker runs the invariant-gate boot guard without throwing', () => {
  // The real assembleReport still holds its pinned behavior, so construction succeeds.
  assert.doesNotThrow(() => makeWorker({ repo: new InMemoryRepository(), cache: new InMemoryCache(), providers, meta }));
});

test('worker persists an AuditRecord per claim and does not fail the report', async () => {
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  const reportId = 'report-worker-1';
  await seedReport(repo, reportId);

  const input: RawInput = {
    sourceType: 'transcript',
    // A factual-looking sentence so the mock LLM extracts at least one claim.
    transcript: 'A study found that 50 percent of people agree with the data.',
  };
  const job: Job = { reportId, contentId: 'content-1', urlHash: 'hash-1', input };

  const handleJob = makeWorker({ repo, cache, providers, meta });
  await handleJob(job);

  const finished = await repo.getReport(reportId);
  assert.ok(finished, 'report still present');
  assert.notEqual(finished!.status, 'failed', 'an unmatched/no-evidence claim must not fail the report');

  const audits = repo.auditRecords.get(reportId);
  assert.ok(audits && audits.length >= 1, 'at least one audit record persisted for the report');
  assert.equal(audits!.length, finished!.claims.length, 'one audit record per extracted claim');
});
