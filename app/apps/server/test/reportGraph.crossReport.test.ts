// Feature: report-graph-normalization — Postgres integration test (task 10.3).
// Cross-report queryability of the Normalized_Rows.
// Validates: Requirements 11.1, 11.2
//
// Req 11.1: the normalized schema supports querying claims and citations ACROSS
// multiple reports through indexed columns, WITHOUT parsing analysis_reports.data.
// Req 11.2: a cross-report aggregate query can group/count claims and citations
// by report and by source through SQL joins on the indexed columns.
//
// This is a Postgres integration test: it needs a real database. Without
// TEST_DATABASE_URL/DATABASE_URL it SKIPS cleanly (node:test skip), so the
// offline-first suite stays green with zero API keys / no database. Point it at
// a throwaway DB via TEST_DATABASE_URL (preferred) or DATABASE_URL. When a DB is
// present it:
//   1. applies migrations 001..004 (tolerating "already exists"),
//   2. seeds SEVERAL reports through PostgresRepository.saveReport, so the
//      dual-write populates claims/citations/perspective_links rows. The reports
//      deliberately SHARE a source_url / source_name across reports so the
//      group-by-source aggregate is meaningful,
//   3. runs parameterized aggregate queries against the normalized tables ONLY
//      (never reading analysis_reports.data):
//        - GROUP BY report_id counts of claims and citations per report,
//        - GROUP BY source_url joined claims<-citations: how many reports and
//          citations a given source appears across,
//   4. asserts those counts equal the counts produced by projectReportGraph for
//      the same reports — i.e. the SQL aggregate agrees with the projection.
//
// All SQL is parameterized (the seeded report ids are passed as an array via
// `= ANY($1)`, never interpolated) and scoped to this test's ids, so it is
// isolated and repeatable on a shared DB. Seeded rows are cleaned up in a
// finally block (content_items delete cascades to reports -> claims/citations).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import { PostgresRepository, makePgPool } from '../src/infra/postgres';
import { projectReportGraph } from '../src/core/reportGraph';
import type { AnalysisReport, Citation, ContentItem } from '../src/types';

const DB_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const skip = DB_URL
  ? false
  : 'no TEST_DATABASE_URL/DATABASE_URL — skipping Postgres integration test';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

// Apply every db/migrations/*.sql in lexical order (001..004), tolerating the
// "already exists" errors a reused test DB raises — mirrors scripts/migrate.mjs.
async function applyMigrations(pool: Pool): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    try {
      await pool.query(sql);
    } catch (e) {
      if (!/already exists/i.test((e as Error).message)) throw e;
    }
  }
}

function makeContent(id: string): ContentItem {
  return {
    id,
    urlHash: `crossreport-${id}`,
    sourceType: 'article',
    sourceUrl: 'https://example.com/source',
    title: 'Cross-report test content',
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

function makeReport(
  id: string,
  contentId: string,
  shareSlug: string,
  claims: AnalysisReport['claims'],
): AnalysisReport {
  const now = new Date().toISOString();
  return {
    id,
    contentId,
    urlHash: `crossreport-${contentId}`,
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    tldr: 'tldr',
    issueFrame: { label: 'frame', x: 0, y: 0 },
    claims,
    framingSignals: [],
    contextCards: [],
    perspectives: [],
    confidence: 0.9,
    shareSlug,
    reasons: [],
    createdAt: now,
    updatedAt: now,
  };
}

// A source shared ACROSS reports — the whole point of the group-by-source query.
const SHARED: Citation = {
  sourceUrl: 'https://shared.example/source-x',
  sourceName: 'Shared Source X',
  sourceTier: 'tier2_institutional',
  supports: true,
};

test('cross-report aggregates group/count claims and citations by report and by source on the normalized tables only (Req 11.1, 11.2)', { skip }, async () => {
  const pool = makePgPool(DB_URL as string);
  const repo = new PostgresRepository(pool);

  // Three reports, each with its own content row. Overlapping source_url across
  // reports (SHARED) so the by-source aggregate spans reports.
  const contentA = randomUUID();
  const contentB = randomUUID();
  const contentC = randomUUID();
  const reportA = randomUUID();
  const reportB = randomUUID();
  const reportC = randomUUID();
  const reportIds = [reportA, reportB, reportC];

  // Report A: claim-a1 (moderate, 2 citations: SHARED + A-only), claim-a2
  // (honest 'none', zero citations). -> 2 claims, 2 citations.
  const a = makeReport(reportA, contentA, `crossreport-${randomUUID()}`, [
    {
      id: 'claim-a1',
      claimText: 'A1: cited claim',
      verifiability: 'verifiable',
      evidenceStrength: 'moderate',
      confidence: 0.8,
      citations: [
        SHARED,
        { sourceUrl: 'https://a.example/only', sourceName: 'A Only', sourceTier: 'tier3_viewpoint', supports: true },
      ],
    },
    {
      id: 'claim-a2',
      claimText: 'A2: honest none',
      verifiability: 'opinion',
      evidenceStrength: 'none',
      confidence: 0.7,
      citations: [],
    },
  ]);

  // Report B: claim-b1 (strong, 1 citation: SHARED). -> 1 claim, 1 citation.
  const b = makeReport(reportB, contentB, `crossreport-${randomUUID()}`, [
    {
      id: 'claim-b1',
      claimText: 'B1: cited claim',
      verifiability: 'verifiable',
      evidenceStrength: 'strong',
      confidence: 0.9,
      citations: [SHARED],
    },
  ]);

  // Report C: claim-c1 (weak, 1 citation: SHARED), claim-c2 (moderate, 1
  // citation: C-only). -> 2 claims, 2 citations.
  const c = makeReport(reportC, contentC, `crossreport-${randomUUID()}`, [
    {
      id: 'claim-c1',
      claimText: 'C1: cited claim',
      verifiability: 'partially_verifiable',
      evidenceStrength: 'weak',
      confidence: 0.6,
      citations: [SHARED],
    },
    {
      id: 'claim-c2',
      claimText: 'C2: cited claim',
      verifiability: 'verifiable',
      evidenceStrength: 'moderate',
      confidence: 0.75,
      citations: [
        { sourceUrl: 'https://c.example/only', sourceName: 'C Only', sourceTier: 'tier1_primary', supports: false },
      ],
    },
  ]);

  const reports = [a, b, c];

  try {
    await applyMigrations(pool);
    await repo.saveContent(makeContent(contentA));
    await repo.saveContent(makeContent(contentB));
    await repo.saveContent(makeContent(contentC));
    for (const r of reports) await repo.saveReport(r);

    // ── Expected counts come from the pure projection — the SQL aggregate must
    // agree with what projectReportGraph produced for each report. ──
    const expectedClaimsByReport = new Map<string, number>();
    const expectedCitationsByReport = new Map<string, number>();
    for (const r of reports) {
      const g = projectReportGraph(r);
      expectedClaimsByReport.set(r.id, g.claims.length);
      expectedCitationsByReport.set(r.id, g.citations.length);
    }

    // ── Req 11.2: GROUP BY report_id — claims per report (normalized tables only).
    const claimsPerReport = await pool.query(
      `SELECT report_id, COUNT(*)::int AS claim_count
         FROM claims
        WHERE report_id = ANY($1)
        GROUP BY report_id`,
      [reportIds],
    );
    const claimCounts = new Map<string, number>(
      claimsPerReport.rows.map((row) => [row.report_id as string, row.claim_count as number]),
    );
    for (const r of reports) {
      assert.equal(
        claimCounts.get(r.id),
        expectedClaimsByReport.get(r.id),
        `claims GROUP BY report_id count for ${r.id} should match the projection`,
      );
    }

    // ── Req 11.2: GROUP BY report_id — citations per report, joined claims<-citations.
    // LEFT JOIN so a report whose only claim is an honest 'none' (zero citations)
    // still appears with a count of 0 rather than dropping out.
    const citationsPerReport = await pool.query(
      `SELECT cl.report_id, COUNT(c.id)::int AS citation_count
         FROM claims cl
         LEFT JOIN citations c ON c.claim_id = cl.id
        WHERE cl.report_id = ANY($1)
        GROUP BY cl.report_id`,
      [reportIds],
    );
    const citationCounts = new Map<string, number>(
      citationsPerReport.rows.map((row) => [row.report_id as string, row.citation_count as number]),
    );
    for (const r of reports) {
      assert.equal(
        citationCounts.get(r.id),
        expectedCitationsByReport.get(r.id),
        `citations GROUP BY report_id count for ${r.id} should match the projection`,
      );
    }

    // ── Req 11.2: GROUP BY source — how many citations and how many DISTINCT
    // reports a given source appears across, joined to claims for report_id.
    // SHARED is cited once in each of A, B, C -> 3 citations across 3 reports.
    const bySource = await pool.query(
      `SELECT c.source_url,
              COUNT(*)::int                       AS citation_count,
              COUNT(DISTINCT cl.report_id)::int   AS report_count
         FROM citations c
         JOIN claims cl ON cl.id = c.claim_id
        WHERE cl.report_id = ANY($1)
        GROUP BY c.source_url`,
      [reportIds],
    );
    const bySrc = new Map<string, { citations: number; reports: number }>(
      bySource.rows.map((row) => [
        row.source_url as string,
        { citations: row.citation_count as number, reports: row.report_count as number },
      ]),
    );

    // The shared source spans all three reports.
    assert.deepEqual(
      bySrc.get(SHARED.sourceUrl),
      { citations: 3, reports: 3 },
      'shared source should appear in 3 citations across 3 distinct reports',
    );
    // The per-report-only sources are confined to their single report.
    assert.deepEqual(bySrc.get('https://a.example/only'), { citations: 1, reports: 1 });
    assert.deepEqual(bySrc.get('https://c.example/only'), { citations: 1, reports: 1 });

    // Cross-check the by-source totals against the projection: total citations
    // over all seeded reports = sum of per-source citation counts (for our ids).
    const expectedTotalCitations = [...expectedCitationsByReport.values()].reduce((s, n) => s + n, 0);
    const aggregateTotalCitations = [...bySrc.values()].reduce((s, v) => s + v.citations, 0);
    assert.equal(
      aggregateTotalCitations,
      expectedTotalCitations,
      'sum of by-source citation counts should equal the total projected citations',
    );

    // ── Req 11.2: the same grouping works by source_name (the other indexed-ish
    // dimension the task names) — SHARED's name spans the three reports too.
    const byName = await pool.query(
      `SELECT c.source_name, COUNT(DISTINCT cl.report_id)::int AS report_count
         FROM citations c
         JOIN claims cl ON cl.id = c.claim_id
        WHERE cl.report_id = ANY($1) AND c.source_name = $2
        GROUP BY c.source_name`,
      [reportIds, SHARED.sourceName],
    );
    assert.equal(byName.rowCount, 1);
    assert.equal(byName.rows[0].report_count, 3, 'shared source_name should span 3 reports');
  } finally {
    // Cleanup: deleting content_items cascades to analysis_reports -> claims ->
    // citations and perspective_links. Parameterized, scoped to this test's ids.
    await pool.query('DELETE FROM content_items WHERE id = ANY($1)', [[contentA, contentB, contentC]]).catch(() => {});
    await pool.end();
  }
});
