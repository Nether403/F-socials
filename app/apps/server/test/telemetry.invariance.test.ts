// Feature: observability-instrumentation, Property 8: Offline / telemetry-invariance of the pipeline report.
// Validates: Requirements 3.7, 11.2, 11.3, 11.7
//
// For any analysis input and the deterministic offline provider set, the report the
// worker persists under No_Op_Telemetry is field-by-field equal — status, reasons,
// claims, citations, audits, and context — to the report it persists under an active
// Telemetry_Port, excluding only fields that are already non-deterministic today: the
// per-claim `randomUUID` ids (Claim.id, AuditRecord.claimId) and the wall-clock
// timestamps (createdAt/updatedAt, provenance.lastUpdated, AuditRecord.createdAt) plus
// the randomUUID-derived shareSlug. Everything runs offline against in-memory infra and
// mock providers with stub telemetry backends — zero outbound network.
//
// The active run uses a RECORDING backend so the active emission path is genuinely
// exercised (we assert it emitted a pipeline_complete event). A final non-PBT example
// pins Req 11.7 specifically: even a telemetry backend that THROWS on every call leaves
// the persisted report byte-identical to the no-op run.

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { makeWorker } from '../src/pipeline/worker';
import { InMemoryCache, InMemoryRepository } from '../src/infra/memory';
import { noopTelemetry } from '../src/infra/telemetry/noop';
import { makeActiveTelemetry } from '../src/infra/telemetry/active';
import {
  mockEvidence,
  mockLLM,
  mockNormalizer,
  mockPerspective,
  mockValidator,
  passthroughTranscript,
} from '../src/providers/mock';
import type { Providers } from '../src/providers/types';
import type { AnalysisReport, AuditRecord, RawInput } from '../src/types';
import type { Job, Telemetry } from '../src/infra/ports';

const providers: Providers = {
  transcript: passthroughTranscript,
  llm: mockLLM,
  evidence: mockEvidence,
  perspective: mockPerspective,
  normalizer: mockNormalizer,
  validator: mockValidator,
};

const meta = { model: 'mock', analysisVersion: 'test', sourcePolicyVersion: 'test' };
const REPORT_ID = 'inv-report';
const URL_HASH = 'inv-hash';

// A pool of sentences mixing factual-looking claims (numbers/percent/study → the mock
// LLM marks them 'verifiable'), high-arousal framing triggers, and plain opinion, so a
// generated transcript exercises claims, framing signals, evidence, and the gate.
const SENTENCE = fc.constantFrom(
  'A study found that 50 percent of people agree with the data.',
  'The report shows 30% growth this year.',
  'Data indicates a 12 percent decline in usage.',
  'This is absolutely shocking and everyone is outraged!!',
  'Nobody will ever believe this disaster will end well.',
  'The committee always destroys good ideas.',
  'The weather is pleasant today.',
  'Pineapple is the best pizza topping.',
  'Researchers published a report with new statistics.',
  'It is a calm and ordinary afternoon.',
);

// Random analysis inputs: mostly transcript text (the richest deterministic path),
// plus url-backed sources whose mock transcript is a deterministic placeholder.
const inputArb: fc.Arbitrary<RawInput> = fc.oneof(
  fc
    .array(SENTENCE, { minLength: 0, maxLength: 8 })
    .map((ss) => ({ sourceType: 'transcript' as const, transcript: ss.join(' ') })),
  fc
    .webUrl()
    .map((url) => ({ sourceType: 'article' as const, url })),
);

function seedQueued(repo: InMemoryRepository): Promise<void> {
  const now = new Date().toISOString();
  const report: AnalysisReport = {
    id: REPORT_ID,
    contentId: 'content-1',
    urlHash: URL_HASH,
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

// Strip the fields that are non-deterministic TODAY (independent of telemetry) so the
// comparison isolates telemetry's effect on the report — which must be none.
function normalizeReport(report: AnalysisReport): unknown {
  const { createdAt, updatedAt, shareSlug, provenance, claims, ...rest } = report;
  void createdAt;
  void updatedAt;
  void shareSlug;
  return {
    ...rest,
    claims: claims.map(({ id, ...claim }) => {
      void id;
      return claim;
    }),
    provenance: provenance
      ? (() => {
          const { lastUpdated, ...p } = provenance;
          void lastUpdated;
          return p;
        })()
      : provenance,
  };
}

function normalizeAudits(audits: readonly AuditRecord[]): unknown {
  return audits.map(({ claimId, createdAt, ...audit }) => {
    void claimId;
    void createdAt;
    return audit;
  });
}

// Run one job to completion through a freshly-built worker with the given telemetry,
// into a fresh in-memory repo. Returns the persisted report + its audit records.
async function runOnce(
  input: RawInput,
  telemetry: Telemetry,
): Promise<{ report: AnalysisReport; audits: AuditRecord[] }> {
  const repo = new InMemoryRepository();
  const cache = new InMemoryCache();
  await seedQueued(repo);
  const handleJob = makeWorker({ repo, cache, telemetry, providers, meta });
  const job: Job = { reportId: REPORT_ID, contentId: 'content-1', urlHash: URL_HASH, input };
  await handleJob(job);
  const report = await repo.getReport(REPORT_ID);
  assert.ok(report, 'report persisted');
  return { report: report!, audits: repo.auditRecords.get(REPORT_ID) ?? [] };
}

test('Property 8: the persisted report is identical under active vs no-op telemetry', async () => {
  await fc.assert(
    fc.asyncProperty(inputArb, async (input) => {
      // No-op telemetry baseline.
      const baseline = await runOnce(input, noopTelemetry);

      // Active telemetry with a RECORDING posthog backend: the active emission path is
      // genuinely exercised (not silently a no-op), so this is a real active-vs-no-op
      // comparison, not no-op-vs-no-op.
      const events: Array<{ event: string; properties: Record<string, unknown> }> = [];
      const active = makeActiveTelemetry({
        sentry: { captureException() {} },
        posthog: { capture: (a) => events.push(a) },
      });
      const activeRun = await runOnce(input, active);

      // The active port actually emitted the pipeline_complete event for this run.
      assert.ok(
        events.some((e) => e.event === 'pipeline_complete'),
        'active telemetry emitted pipeline_complete (active path exercised)',
      );

      // Field-by-field equality of everything that is NOT already non-deterministic.
      assert.deepStrictEqual(normalizeReport(activeRun.report), normalizeReport(baseline.report));
      assert.deepStrictEqual(normalizeAudits(activeRun.audits), normalizeAudits(baseline.audits));
    }),
    { numRuns: 120 },
  );
});

test('Property 8 (Req 11.7): a telemetry backend that throws never changes the report', async () => {
  const input: RawInput = {
    sourceType: 'transcript',
    transcript: 'A study found that 50 percent of people agree with the data. This is shocking!!',
  };
  const baseline = await runOnce(input, noopTelemetry);

  // Backend throws on EVERY call — the active port must contain the fault (fail-open)
  // and the persisted report must remain byte-identical to the no-op baseline.
  const throwing = makeActiveTelemetry({
    sentry: { captureException() { throw new Error('sentry down'); } },
    posthog: { capture() { throw new Error('posthog down'); } },
  });
  const throwingRun = await runOnce(input, throwing);

  assert.deepStrictEqual(normalizeReport(throwingRun.report), normalizeReport(baseline.report));
  assert.deepStrictEqual(normalizeAudits(throwingRun.audits), normalizeAudits(baseline.audits));
});
