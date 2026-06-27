// Feature: report-graph-normalization — Durability under normalized-write failure.
// Validates: Requirements 4.1, 4.3, 4.5
//
// Analytics is additive: a failure of the normalized (report-graph) write must
// never damage the served report. This example test exercises the documented
// best-effort path that lives in PostgresRepository.saveReport — the JSONB
// upsert commits independently, then writeReportGraph runs in its own
// transaction and, on failure, is caught + logged with the report_id and never
// rethrown (mirroring saveAuditRecord).
//
// We drive a real PostgresRepository against a fake pg Pool that:
//   - accepts the analysis_reports upsert and stores the JSONB payload,
//   - serves it back on getReport / getReportBySlug, and
//   - hands writeReportGraph a client whose claims INSERT throws mid-transaction.
// We then assert: saveReport resolves (never rethrows, Req 4.1), the intact
// JSONB report is still served by both getReport and getReportBySlug (Req 4.3),
// and console.error named the affected report_id (Req 4.5).

import test from 'node:test';
import assert from 'node:assert/strict';

import { PostgresRepository } from '../src/infra/postgres';
import type { AnalysisReport } from '../src/types';

// A gate-valid report with a cited claim (so the projection produces rows the
// normalized write would attempt to INSERT) and a shareSlug (so getReportBySlug
// has something to find). Hand-built — this is an example test, not a property.
const report: AnalysisReport = {
  id: 'report-durability-1',
  contentId: 'content-1',
  urlHash: 'hash-durability-1',
  status: 'ready',
  version: 1,
  producingLayer: 'ai',
  tldr: 'A short summary.',
  issueFrame: { label: 'Test frame', x: 0, y: 0 },
  claims: [
    {
      id: 'claim-1',
      claimText: 'A verifiable claim.',
      verifiability: 'verifiable',
      evidenceStrength: 'moderate',
      confidence: 0.8,
      citations: [
        {
          sourceUrl: 'https://example.org/a',
          sourceName: 'Example Org',
          sourceTier: 'tier2_institutional',
          excerpt: 'supporting excerpt',
          supports: true,
        },
      ],
    },
  ],
  framingSignals: [],
  contextCards: [],
  perspectives: [
    {
      url: 'https://example.com/p',
      sourceName: 'Other View',
      sourceTier: 'tier3_viewpoint',
      issueFrameLabel: 'Other frame',
      divergence: 0.5,
      dehumanization: 0.1,
    },
  ],
  confidence: 0.8,
  shareSlug: 'slug-durability-1',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

// A fake pg client whose normalized-write transaction fails on the claims
// INSERT, after BEGIN + the DELETEs — exercising the rollback path too.
class FailingClient {
  released = false;
  rolledBack = false;
  async query(sql: string): Promise<unknown> {
    if (sql.startsWith('BEGIN')) return {};
    if (sql.startsWith('DELETE')) return { rows: [], rowCount: 0 };
    if (sql.includes('INSERT INTO claims')) {
      throw new Error('forced normalized-write failure');
    }
    if (sql.startsWith('ROLLBACK')) {
      this.rolledBack = true;
      return {};
    }
    return {};
  }
  release(): void {
    this.released = true;
  }
}

// A fake pg Pool: the analysis_reports upsert succeeds and stores the JSONB
// payload (round-tripped through JSON like a real JSONB column); SELECTs serve
// it back; connect() yields the failing client so writeReportGraph throws.
class FakePool {
  byId = new Map<string, AnalysisReport>();
  bySlug = new Map<string, AnalysisReport>();
  client = new FailingClient();

  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
    if (sql.includes('INSERT INTO analysis_reports')) {
      const id = params![0] as string;
      const slug = params![7] as string | null;
      const data = JSON.parse(params![9] as string) as AnalysisReport; // JSONB round-trip
      this.byId.set(id, data);
      if (slug != null) this.bySlug.set(slug, data);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM analysis_reports WHERE id =')) {
      const data = this.byId.get(params![0] as string);
      return data ? { rows: [{ data }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes('FROM analysis_reports WHERE share_slug =')) {
      const data = this.bySlug.get(params![0] as string);
      return data ? { rows: [{ data }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    throw new Error(`unexpected query: ${sql}`);
  }

  async connect(): Promise<FailingClient> {
    return this.client;
  }
}

test('normalized-write failure leaves the JSONB report served and logs the report_id', async () => {
  const pool = new FakePool();
  // PostgresRepository only uses the Pool surface (query/connect) we provide.
  const repo = new PostgresRepository(pool as never);

  // Capture console.error around the save (restore in finally).
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    calls.push(args);
  };

  try {
    // Req 4.1: the normalized-write failure must not propagate out of saveReport.
    await assert.doesNotReject(
      repo.saveReport(report),
      'saveReport must not rethrow a normalized-write failure',
    );
  } finally {
    console.error = original;
  }

  // Req 4.3: the intact JSONB report is still served from both read paths.
  const byId = await repo.getReport(report.id);
  assert.deepEqual(byId, report, 'getReport still serves the intact JSONB report');

  const bySlug = await repo.getReportBySlug(report.shareSlug!);
  assert.deepEqual(bySlug, report, 'getReportBySlug still serves the intact JSONB report');

  // The normalized write actually ran and rolled back (best-effort, isolated).
  assert.equal(pool.client.rolledBack, true, 'the failed normalized write rolled back');
  assert.equal(pool.client.released, true, 'the client was released');

  // Req 4.5: the failure was logged identifying the affected report_id.
  const named = calls.some((args) =>
    args.some((a) => typeof a === 'string' && a.includes(report.id)),
  );
  assert.ok(named, `console.error should name report_id ${report.id}; calls: ${JSON.stringify(calls.map((c) => c[0]))}`);
});
