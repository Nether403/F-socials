// Feature: report-graph-normalization — integration test (task 10.2)
// Transactional atomicity of the normalized write.
// Validates: Requirements 4.4
//
// writeReportGraph rewrites one report's Normalized_Rows as a single
// delete-then-insert transaction (see core design "Idempotent replace" /
// "Error Handling"). Req 4.4: a failure mid-rewrite must ROLL BACK, leaving the
// PRIOR complete row set intact — a reader never observes a partial set.
//
// This is a Postgres integration test: it needs a real database. Without
// TEST_DATABASE_URL/DATABASE_URL it SKIPS cleanly (node:test skip), so the
// offline-first suite stays green. When a DB is present it:
//   1. applies migrations 001..004 (tolerating "already exists"),
//   2. saves a report once so it has a COMPLETE normalized row set (v1),
//   3. saves the SAME report.id again with content that fails mid-rewrite — a
//      citation carrying an invalid source_tier enum value. The claims re-insert
//      succeeds, then the citations insert throws, so the transaction rolls back.
//   4. asserts the report's claims/citations/perspective_links still equal the
//      v1 set exactly — no v2 rows, no partial/empty set.
//
// saveReport swallows the normalized-write error (best-effort), so the failure
// surfaces only via direct table queries after the call returns. All SQL is
// parameterized; the seeded data is cleaned up in a finally block.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import { PostgresRepository, makePgPool } from '../src/infra/postgres';
import type { AnalysisReport, Citation, ContentItem, SourceTier } from '../src/types';

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
    urlHash: `atomicity-${id}`,
    sourceType: 'article',
    sourceUrl: 'https://example.com/source',
    title: 'Atomicity test content',
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

// Base report shared by v1/v2 — same id + contentId so the second save is an
// idempotent rewrite of the same report's normalized rows.
function makeReport(
  id: string,
  contentId: string,
  shareSlug: string,
  claims: AnalysisReport['claims'],
  perspectives: AnalysisReport['perspectives'],
): AnalysisReport {
  const now = new Date().toISOString();
  return {
    id,
    contentId,
    urlHash: `atomicity-${contentId}`,
    status: 'ready',
    version: 1,
    producingLayer: 'ai',
    tldr: 'tldr',
    issueFrame: { label: 'frame', x: 0, y: 0 },
    claims,
    framingSignals: [],
    contextCards: [],
    perspectives,
    confidence: 0.9,
    shareSlug,
    reasons: [],
    createdAt: now,
    updatedAt: now,
  };
}

test('normalized rewrite is atomic: a mid-rewrite failure rolls back to the prior complete set (Req 4.4)', { skip }, async () => {
  const pool = makePgPool(DB_URL as string);
  const repo = new PostgresRepository(pool);

  const reportId = randomUUID();
  const contentId = randomUUID();
  const shareSlug = `atomicity-${randomUUID()}`;

  try {
    await applyMigrations(pool);
    await repo.saveContent(makeContent(contentId));

    // ── v1: a COMPLETE, gate-valid normalized set ──
    // claim A: non-'none' strength + 1 citation; claim B: honest 'none' + zero
    // citations; plus one perspective link.
    const v1Citation: Citation = {
      sourceUrl: 'https://example.com/v1-a',
      sourceName: 'V1 Source A',
      sourceTier: 'tier1_primary',
      supports: true,
    };
    const v1 = makeReport(
      reportId,
      contentId,
      shareSlug,
      [
        {
          id: 'claim-a',
          claimText: 'V1 claim A',
          verifiability: 'verifiable',
          evidenceStrength: 'strong',
          confidence: 0.9,
          citations: [v1Citation],
        },
        {
          id: 'claim-b',
          claimText: 'V1 claim B (honest none)',
          verifiability: 'opinion',
          evidenceStrength: 'none',
          confidence: 0.8,
          citations: [],
        },
      ],
      [
        {
          url: 'https://example.com/v1-perspective',
          sourceName: 'V1 Perspective',
          sourceTier: 'tier2_institutional',
          issueFrameLabel: 'frame',
          divergence: 0.5,
          dehumanization: 0.1,
        },
      ],
    );

    await repo.saveReport(v1);

    // Sanity: the v1 normalized set is complete before we attempt the failing rewrite.
    assert.deepEqual(await readGraph(pool, reportId), {
      claims: [
        { claim_uid: 'claim-a', claim_text: 'V1 claim A', evidence_strength: 'strong' },
        { claim_uid: 'claim-b', claim_text: 'V1 claim B (honest none)', evidence_strength: 'none' },
      ],
      citations: [
        { claim_uid: 'claim-a', source_url: 'https://example.com/v1-a', source_tier: 'tier1_primary' },
      ],
      perspectives: [
        { url: 'https://example.com/v1-perspective', source_tier: 'tier2_institutional' },
      ],
    });

    // ── v2: same report.id, DIFFERENT content, with a poisoned citation ──
    // The first claim's citation carries an invalid source_tier enum value. In
    // writeReportGraph the claims re-insert (valid enums) succeeds, then the
    // citations insert hits the bad enum and throws -> ROLLBACK. saveReport
    // catches/logs the error and returns normally.
    const poisonedTier = 'not_a_real_tier' as unknown as SourceTier;
    const v2 = makeReport(
      reportId,
      contentId,
      shareSlug,
      [
        {
          id: 'claim-a',
          claimText: 'V2 CHANGED claim A',
          verifiability: 'verifiable',
          evidenceStrength: 'strong',
          confidence: 0.9,
          citations: [
            {
              sourceUrl: 'https://example.com/v2-a',
              sourceName: 'V2 Source A',
              sourceTier: poisonedTier, // <- violates the source_tier enum constraint
              supports: true,
            },
          ],
        },
        {
          id: 'claim-c',
          claimText: 'V2 NEW claim C',
          verifiability: 'verifiable',
          evidenceStrength: 'moderate',
          confidence: 0.7,
          citations: [
            {
              sourceUrl: 'https://example.com/v2-c',
              sourceName: 'V2 Source C',
              sourceTier: 'tier3_viewpoint',
              supports: false,
            },
          ],
        },
      ],
      [
        {
          url: 'https://example.com/v2-perspective',
          sourceName: 'V2 Perspective',
          sourceTier: 'tier3_viewpoint',
          issueFrameLabel: 'frame',
          divergence: 0.9,
          dehumanization: 0.2,
        },
      ],
    );

    // saveReport swallows the normalized-write failure (best-effort) — it must
    // not throw, and the report stays served.
    await repo.saveReport(v2);
    assert.notEqual(await repo.getReport(reportId), undefined, 'report stays served from JSONB');

    // ── Req 4.4: the PRIOR complete set survived intact — no partial set, no v2
    // rows. We must still see exactly v1's claims/citations/perspectives. If the
    // rewrite had leaked a partial set we'd see v2's claim-c, the poisoned
    // citation would be absent yet claim-a's text changed, or v1's claim-b/
    // citation/perspective would be gone.
    assert.deepEqual(await readGraph(pool, reportId), {
      claims: [
        { claim_uid: 'claim-a', claim_text: 'V1 claim A', evidence_strength: 'strong' },
        { claim_uid: 'claim-b', claim_text: 'V1 claim B (honest none)', evidence_strength: 'none' },
      ],
      citations: [
        { claim_uid: 'claim-a', source_url: 'https://example.com/v1-a', source_tier: 'tier1_primary' },
      ],
      perspectives: [
        { url: 'https://example.com/v1-perspective', source_tier: 'tier2_institutional' },
      ],
    });
  } finally {
    // Cleanup: deleting the content_items row cascades to analysis_reports ->
    // claims -> citations and perspective_links. Parameterized, scoped to this
    // test's ids only.
    await pool.query('DELETE FROM content_items WHERE id = $1', [contentId]).catch(() => {});
    await pool.end();
  }
});

// Read the report's normalized rows back as plain comparable shapes (parameterized
// SQL, deterministic ordering). claims by ordinal; citations joined to their claim
// so we assert linkage by claim_uid; perspectives by url.
async function readGraph(pool: Pool, reportId: string) {
  const claims = await pool.query(
    `SELECT claim_uid, claim_text, evidence_strength
       FROM claims WHERE report_id = $1 ORDER BY ordinal`,
    [reportId],
  );
  const citations = await pool.query(
    `SELECT cl.claim_uid, c.source_url, c.source_tier::text AS source_tier
       FROM citations c JOIN claims cl ON cl.id = c.claim_id
      WHERE cl.report_id = $1
      ORDER BY c.source_url`,
    [reportId],
  );
  const perspectives = await pool.query(
    `SELECT url, source_tier::text AS source_tier
       FROM perspective_links WHERE report_id = $1 ORDER BY url`,
    [reportId],
  );
  return {
    claims: claims.rows.map((r) => ({
      claim_uid: r.claim_uid,
      claim_text: r.claim_text,
      evidence_strength: r.evidence_strength,
    })),
    citations: citations.rows.map((r) => ({
      claim_uid: r.claim_uid,
      source_url: r.source_url,
      source_tier: r.source_tier,
    })),
    perspectives: perspectives.rows.map((r) => ({ url: r.url, source_tier: r.source_tier })),
  };
}
