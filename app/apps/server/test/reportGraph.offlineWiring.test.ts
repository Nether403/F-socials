// Feature: report-graph-normalization — example test (task 9.2)
// Offline wiring (Validates: Requirements 6.5): with no DATABASE_URL the
// composed repository is the InMemoryRepository (the zero-API-key offline path),
// and saving a report through it persists the Normalized_Rows.
//
// config.ts reads process.env exactly once, at import time, via ./env — which
// lets *real* env vars win over the repo's .env file. So we force the offline
// path BEFORE the first import of compose/config and dynamically import
// buildContext afterwards. DATABASE_URL is set to '' (empty, not deleted): an
// empty string still counts as "real env present", so env.ts preserves it and
// it beats the .env's postgres DATABASE_URL — reproducing the absent condition.
// The other drivers/providers are pinned to the offline mocks so composing the
// context never reaches out to Redis/Postgres/Gemini during the test.

import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepository } from '../src/infra/memory';
import type { AnalysisReport } from '../src/types';

// --- force the offline path before config.ts snapshots process.env ---
const OFFLINE_ENV: Record<string, string> = {
  REPO_DRIVER: 'memory', // default/offline repository driver
  CACHE_DRIVER: 'memory',
  QUEUE_DRIVER: 'memory',
  DATABASE_URL: '', // no database -> offline repo selected
  REDIS_URL: '',
  LLM_PROVIDER: 'mock',
  EVIDENCE_PROVIDER: 'mock',
  PERSPECTIVE_PROVIDER: 'mock',
};

const saved: Record<string, string | undefined> = {};
for (const key of Object.keys(OFFLINE_ENV)) {
  saved[key] = process.env[key];
  process.env[key] = OFFLINE_ENV[key];
}

// Dynamic import so the env overrides above are in place when config.ts reads them.
const { buildContext } = await import('../src/compose');

// config.ts has now snapshotted the env; restore the real values for any sibling.
for (const key of Object.keys(OFFLINE_ENV)) {
  if (saved[key] === undefined) delete process.env[key];
  else process.env[key] = saved[key];
}

// A minimal gate-valid report: one honest 'none'/zero-citation claim and one
// cited claim (so both claimRows and citationRows are exercised) plus one
// perspective. Hand-built to keep this a pure example test (no fast-check).
function minimalReport(): AnalysisReport {
  const now = new Date().toISOString();
  return {
    id: 'offline-wiring-report-1',
    contentId: 'content-1',
    urlHash: 'hash-offline-wiring',
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    tldr: 'A short summary.',
    issueFrame: { label: 'Example issue', x: 0, y: 0 },
    claims: [
      {
        id: 'claim-honest-none',
        claimText: 'An honestly uncited claim.',
        verifiability: 'unverifiable',
        evidenceStrength: 'none',
        confidence: 0.6,
        citations: [],
      },
      {
        id: 'claim-cited',
        claimText: 'A claim backed by one source.',
        verifiability: 'verifiable',
        evidenceStrength: 'strong',
        confidence: 0.9,
        citations: [
          {
            sourceUrl: 'https://example.org/article',
            sourceName: 'Example Source',
            sourceTier: 'tier2_institutional',
            supports: true,
          },
        ],
      },
    ],
    framingSignals: [],
    contextCards: [],
    perspectives: [
      {
        url: 'https://example.com/other-view',
        sourceName: 'Other View',
        sourceTier: 'tier3_viewpoint',
        issueFrameLabel: 'Counterpoint',
        divergence: 0.5,
        dehumanization: 0,
      },
    ],
    confidence: 0.8,
    shareSlug: 'offline-wiring-slug-1',
    createdAt: now,
    updatedAt: now,
  };
}

test('offline wiring: composed repo is InMemoryRepository and persists Normalized_Rows (Req 6.5)', async () => {
  const { repo } = buildContext();

  // With no DATABASE_URL and the default/memory driver, the offline path is chosen.
  assert.ok(
    repo instanceof InMemoryRepository,
    'expected the offline path (no DATABASE_URL) to compose an InMemoryRepository',
  );

  const report = minimalReport();
  await repo.saveReport(report);

  // JSONB payload is still the served source of truth.
  const served = await repo.getReport(report.id);
  assert.ok(served, 'report should be retrievable from its JSONB payload after save');

  // The dual-write persisted the Normalized_Rows for this report.
  const mem = repo as InMemoryRepository;

  const claimRows = mem.claimRows.get(report.id);
  assert.ok(claimRows, 'claimRows should be populated for the report.id');
  assert.equal(claimRows.length, report.claims.length, 'one claim row per claim');

  const citationRows = mem.citationRows.get(report.id);
  assert.ok(citationRows, 'citationRows should be populated for the report.id');
  assert.equal(citationRows.length, 1, 'one citation row for the single cited claim');

  const perspectiveRows = mem.perspectiveRows.get(report.id);
  assert.ok(perspectiveRows, 'perspectiveRows should be populated for the report.id');
  assert.equal(perspectiveRows.length, report.perspectives.length, 'one perspective row per perspective');

  // And the backfill skip-check agrees the graph now exists.
  assert.equal(await repo.hasReportGraph(report.id), true, 'hasReportGraph should be true after the dual-write');
});
