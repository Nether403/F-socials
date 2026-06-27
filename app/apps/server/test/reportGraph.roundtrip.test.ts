// Feature: report-graph-normalization, Property 3: Round-trip projection consistency
// Validates: Requirements 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4
//
// For any gate-valid report, persist it then read its normalized rows back and
// compare them to the report's JSONB payload (the same report object getReport
// serves). Every projected field must match its source field:
//   - each claim row: claimText, verifiability, evidenceStrength, confidence,
//     transcriptSpan, sourceBasis, reportId, and claimUid === the originating
//     Claim.id (the stable traceback, Req 2.6);
//   - each citation row: sourceUrl, sourceName, sourceTier, excerpt, supports;
//   - each perspective row: url, sourceName, sourceTier, issueFrameLabel,
//     divergence (-> divergence_score), dehumanization (-> dehumanization_score).
// Claims align to source claims by ordinal/index; citations align per claim by
// order; perspectives align by index. Optional fields omitted when absent
// (transcriptSpan, sourceBasis, excerpt) must be omitted (undefined) on the row
// exactly when the source omits them. Run against InMemoryRepository, which
// exercises the same projectReportGraph dual-write path as Postgres.

import test from 'node:test';
import assert from 'node:assert/strict';

import fc from 'fast-check';

import { InMemoryRepository } from '../src/infra/memory';
import { gateValidReportArbitrary } from './reportGraph.arb';

test('round-trip projection consistency: every normalized field matches the JSONB source', async () => {
  await fc.assert(
    fc.asyncProperty(gateValidReportArbitrary, async (report) => {
      const repo = new InMemoryRepository();
      await repo.saveReport(report);

      // Read the JSONB payload (authoritative render source of truth) and the
      // normalized rows back out, then compare row-by-row to the payload.
      const served = await repo.getReport(report.id);
      assert.ok(served !== undefined, 'report retrievable from JSONB');

      const claimRows = repo.claimRows.get(report.id) ?? [];
      const citationRows = repo.citationRows.get(report.id) ?? [];
      const perspectiveRows = repo.perspectiveRows.get(report.id) ?? [];

      // ── Claims: align by ordinal/index to the source claims (Req 2.4, 2.6, 3.1)
      assert.equal(
        claimRows.length,
        served.claims.length,
        'one claim row per source claim',
      );
      served.claims.forEach((claim, index) => {
        const row = claimRows[index];
        assert.ok(row !== undefined, `claim row at ordinal ${index} present`);

        // Stable traceback + ownership.
        assert.equal(row.claimUid, claim.id, 'claimUid === originating Claim.id');
        assert.equal(row.reportId, served.id, 'reportId matches owning report');
        assert.equal(row.ordinal, index, 'ordinal aligns to render index');

        // Required scalar fields.
        assert.equal(row.claimText, claim.claimText);
        assert.equal(row.verifiability, claim.verifiability);
        assert.equal(row.evidenceStrength, claim.evidenceStrength);
        assert.equal(row.confidence, claim.confidence);

        // Optional fields: present iff the source carries them, value-equal when
        // present, omitted (undefined) exactly when the source omits them.
        assert.equal(row.transcriptSpan, claim.transcriptSpan);
        assert.equal('transcriptSpan' in row, claim.transcriptSpan !== undefined);
        assert.equal(row.sourceBasis, claim.sourceBasis);
        assert.equal('sourceBasis' in row, claim.sourceBasis !== undefined);

        // ── Citations for this claim: align per claim by order (Req 2.5, 3.2)
        const claimCitationRows = citationRows.filter((c) => c.claimUid === claim.id);
        assert.equal(
          claimCitationRows.length,
          claim.citations.length,
          'one citation row per source citation of this claim',
        );
        claim.citations.forEach((citation, ci) => {
          const cRow = claimCitationRows[ci];
          assert.ok(cRow !== undefined, `citation row ${ci} present`);
          assert.equal(cRow.claimUid, claim.id, 'citation linked to its claim');
          assert.equal(cRow.sourceUrl, citation.sourceUrl);
          assert.equal(cRow.sourceName, citation.sourceName);
          assert.equal(cRow.sourceTier, citation.sourceTier);
          assert.equal(cRow.supports, citation.supports);
          assert.equal(cRow.excerpt, citation.excerpt);
          assert.equal('excerpt' in cRow, citation.excerpt !== undefined);
        });
      });

      // Every citation row traces back to a present claim row (Req 2.5 linkage):
      // the total across claims equals the full citation row count (no orphans).
      const linkedTotal = served.claims.reduce((n, c) => n + c.citations.length, 0);
      assert.equal(citationRows.length, linkedTotal, 'no orphan or missing citation rows');

      // ── Perspectives: align by index (Req 3.3)
      assert.equal(
        perspectiveRows.length,
        served.perspectives.length,
        'one perspective row per source perspective',
      );
      served.perspectives.forEach((perspective, index) => {
        const row = perspectiveRows[index];
        assert.ok(row !== undefined, `perspective row at index ${index} present`);
        assert.equal(row.reportId, served.id);
        assert.equal(row.url, perspective.url);
        assert.equal(row.sourceName, perspective.sourceName);
        assert.equal(row.sourceTier, perspective.sourceTier);
        assert.equal(row.issueFrameLabel, perspective.issueFrameLabel);
        assert.equal(row.divergence, perspective.divergence); // -> divergence_score
        assert.equal(row.dehumanization, perspective.dehumanization); // -> dehumanization_score
      });
    }),
    { numRuns: 200 },
  );
});
