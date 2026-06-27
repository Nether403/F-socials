# Implementation Plan: report-graph-normalization

## Overview

Implement the committed dual-write so every persisted `AnalysisReport` also projects into the reserved `claims`, `citations`, and `perspective_links` tables. The work is additive and lazy: a new pure projection module (`core/reportGraph.ts`) is folded into the existing `Repository.saveReport` on both drivers — zero call-site changes — plus an ordered migration, a one-shot backfill, and the property/example/integration/smoke tests the design specifies.

Language: TypeScript (Node ESM, `node:test` runner, extensionless relative imports), matching the existing `apps/server` package. Property tests use the already-installed `fast-check` (≥100 runs), run against `InMemoryRepository`.

Non-negotiables enforced throughout: `core/assemble.ts` is never modified, parameterized SQL only, and no creator-reliability dimension anywhere.

## Tasks

- [x] 1. Schema and data-model foundations
  - [x] 1.1 Add Migration_004 `app/db/migrations/004_report_graph.sql`
    - Additive DDL only: `ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_uid TEXT`
    - `CREATE UNIQUE INDEX IF NOT EXISTS uq_claims_report_claimuid ON claims (report_id, claim_uid)`
    - Cross-report query indexes: `idx_citations_source_url`, `idx_citations_source_tier`, `idx_claims_claim_text`, `idx_perspective_source_tier`
    - Standard DDL, preserve all existing `analysis_reports` data and JSONB consumers, no creator-reliability column, ordered after `003_audit_records.sql`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 9.1, 11.1, 11.2_

  - [x] 1.2 Add normalized row types to `app/apps/server/src/types.ts`
    - Define `ClaimRow`, `CitationRow`, `PerspectiveRow` mirroring the DB columns (camelCase TS), reusing the existing `Verifiability`, `EvidenceStrength`, `SourceTier` unions
    - `ClaimRow` carries `claimUid`, `reportId`, `ordinal`; no author/creator-reliability field. `sourceTier` appears only on `CitationRow`/`PerspectiveRow`
    - _Requirements: 2.4, 2.5, 2.6, 9.1, 9.2_

- [x] 2. Pure projection module
  - [x] 2.1 Implement `app/apps/server/src/core/reportGraph.ts`
    - Export `ReportGraph` interface and pure `projectReportGraph(report: AnalysisReport): ReportGraph` (no I/O, no clock, no randomness)
    - One `ClaimRow` per claim (`claimUid = claim.id`, `ordinal` = array index); one `CitationRow` per citation linked by `claimUid`; one `PerspectiveRow` per perspective
    - A `none`/zero-citation claim projects a claim row with zero citation rows; any other claim projects one citation row per citation — read straight off the claim, never re-deriving the gate
    - Omit non-normalized fields (`Claim.evidenceDescription`, `PerspectiveLink.whyIncluded`); tolerate absent optional fields by omitting nullable columns
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.7, 2.8, 3.1, 3.2, 3.3, 3.5, 9.2, 10.2_

  - [x] 2.2 Add guarded inline self-check to `reportGraph.ts`
    - Standard `process.argv[1] === fileURLToPath(import.meta.url)` idiom: project one hand-built gate-valid report and assert cardinality plus a couple of field matches (dependency-free fast-fail)
    - _Requirements: 2.1, 3.1_

- [x] 3. Repository interface and memory driver
  - [x] 3.1 Extend the `Repository` interface in `app/apps/server/src/infra/ports.ts`
    - Add `hasReportGraph(reportId: string): Promise<boolean>` and `listReportIds(): Promise<string[]>` used by the backfill; keep `saveReport` signature unchanged (its contract gains the dual-write guarantee)
    - _Requirements: 6.1_

  - [x] 3.2 Implement dual-write in `app/apps/server/src/infra/memory.ts`
    - Add public, test-readable `claimRows`/`citationRows`/`perspectiveRows` maps keyed by `reportId`, mirroring the existing `disputes`/`flags`/`auditRecords` accessors
    - In `saveReport`: store the report (as today), then replace the three map entries for `report.id` with `projectReportGraph(report)` output (idempotent replace)
    - Implement `hasReportGraph` (check `claimRows` map) and `listReportIds` (iterate the report map)
    - _Requirements: 1.1, 1.3, 1.5, 2.1, 2.2, 2.3, 5.1, 5.2, 5.3, 6.3, 6.4_

- [x] 4. Postgres driver
  - [x] 4.1 Implement dual-write in `app/apps/server/src/infra/postgres.ts`
    - Keep the existing `analysis_reports` upsert committed independently first, then call a private `writeReportGraph(report)` using `projectReportGraph(report)`
    - `writeReportGraph` runs a single delete-then-insert transaction (delete citations by claim, perspective_links and claims by `report_id`; re-insert claims `RETURNING id`, then citations linked to new claim ids, then perspective_links), parameterized SQL only
    - Best-effort: catch errors, log the affected `report_id` via `console.error` (mirroring `saveAuditRecord`), never rethrow, so the report stays served from JSONB
    - _Requirements: 1.1, 1.3, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 6.2_

  - [x] 4.2 Implement `hasReportGraph` and `listReportIds` in `postgres.ts`
    - `hasReportGraph`: parameterized `SELECT 1 FROM claims WHERE report_id = $1 LIMIT 1`
    - `listReportIds`: parameterized `SELECT id FROM analysis_reports`
    - _Requirements: 6.2, 8.1, 8.3_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Backfill command
  - [x] 6.1 Implement `app/apps/server/src/scripts/backfill.ts`
    - Direct-invocation module (run via `tsx`, mirroring `benchmark/runner.ts`): iterate `listReportIds()`, skip reports where `hasReportGraph(id)` is true, otherwise load the report and call `saveReport` (reusing the idempotent dual-write)
    - Per-report try/catch: on failure record the `report_id` and continue; never mutate `analysis_reports.data`; log a summary `{ processed, skipped, failed: [...] }`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 7. Property-based tests (fast-check, ≥100 runs, against InMemoryRepository)
  - [x] 7.1 Add shared `gateValidReportArbitrary` helper `app/apps/server/test/reportGraph.arb.ts`
    - Generates reports in the shape `assemble.ts` emits: claims with `evidenceStrength: 'none'` + zero citations, claims with each non-`none` strength carrying ≥1 citation, varied `sourceTier`, unicode text, empty optional fields, and reports with zero perspectives
    - _Requirements: 2.7, 2.8, 6.3_

  - [x] 7.2 Write property test `test/reportGraph.dualwrite.test.ts`
    - **Property 1: Dual-write populates normalized rows and keeps the JSONB retrievable**
    - **Validates: Requirements 1.1, 1.5, 4.2, 6.3**

  - [x] 7.3 Write property test `test/reportGraph.cardinality.test.ts`
    - **Property 2: Exact cardinality and claim–citation linkage**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.7, 2.8**

  - [x] 7.4 Write property test `test/reportGraph.roundtrip.test.ts`
    - **Property 3: Round-trip projection consistency** (the explicitly-required ≥100-run fast-check test of Req 3.4)
    - **Validates: Requirements 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4**

  - [x] 7.5 Write property test `test/reportGraph.retain.test.ts`
    - **Property 4: Non-normalized fields are retained in JSONB and omitted from rows**
    - **Validates: Requirements 3.5**

  - [x] 7.6 Write property test `test/reportGraph.idempotent.test.ts`
    - **Property 5: Idempotent replace**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x] 7.7 Write property test `test/reportGraph.neutrality.prop.test.ts`
    - **Property 7: Tiers attach to sources only — no creator-reliability dimension**
    - **Validates: Requirements 9.2**

  - [x] 7.8 Write property test `test/reportGraph.gateReflect.test.ts`
    - **Property 8: Faithful reflection of the gate-satisfying state without re-deriving the gate**
    - **Validates: Requirements 10.2**

- [x] 8. Backfill property and example tests
  - [x] 8.1 Write property test `test/reportGraph.backfill.test.ts`
    - **Property 6: Backfill populates JSONB-only reports, skips populated ones, never mutates JSONB**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [x] 8.2 Write example test `test/reportGraph.backfillFailure.test.ts`
    - Mix of good reports plus one that throws on write; assert good reports populated and failed `report_id` reported
    - _Requirements: 8.5_

- [x] 9. Durability, wiring, and neutrality tests
  - [x] 9.1 Write example test `test/reportGraph.durability.test.ts`
    - Force the normalized write to throw; assert `getReport`/`getReportBySlug` still serve the intact JSONB and `console.error` names the `report_id`
    - _Requirements: 4.1, 4.3, 4.5_

  - [x] 9.2 Write example test `test/reportGraph.offlineWiring.test.ts`
    - `selectRepo()` with no `DATABASE_URL` returns `InMemoryRepository`, which persists Normalized_Rows
    - _Requirements: 6.5_

  - [x] 9.3 Write static smoke test `test/reportGraph.neutralityStatic.test.ts`
    - Assert the normalized row types, `projectReportGraph` source, and `004_report_graph.sql` contain no creator-reliability dimension
    - _Requirements: 9.1, 9.3, 7.4_

  - [x] 9.4 Write static smoke test `test/reportGraph.guards.test.ts`
    - Assert `assemble.ts` is unmodified / `assertInvariantGateIntact()` passes, `004_*.sql` exists and lexically sorts after `003_audit_records.sql`, and `writeReportGraph` uses only `$1..$n` placeholders (no string interpolation)
    - _Requirements: 10.1, 7.1, 6.2_

  - [x] 9.5 Write interface-parity smoke test `test/reportGraph.parity.test.ts`
    - Both drivers implement `hasReportGraph`/`listReportIds`; the memory driver exposes `claimRows`/`citationRows`/`perspectiveRows`
    - _Requirements: 6.1, 6.4_

- [x] 10. Postgres integration tests (require a test Postgres)
  - [x] 10.1 Write integration test `test/reportGraph.migration.test.ts`
    - Seed `analysis_reports`, apply `004_report_graph.sql`, assert `claim_uid` + new indexes exist and existing data + `getReport` are intact
    - _Requirements: 7.2, 7.3_

  - [x] 10.2 Write integration test `test/reportGraph.atomicity.test.ts`
    - Force a failure mid-rewrite; assert the prior complete row set survives (no partial set observable)
    - _Requirements: 4.4_

  - [x] 10.3 Write integration test `test/reportGraph.crossReport.test.ts`
    - Seed several reports' rows; run `GROUP BY report_id` and group-by-source joins on the indexed columns; assert correct counts without reading `analysis_reports.data`
    - _Requirements: 11.1, 11.2_

- [x] 11. Wire tests into the suite and final checkpoint
  - [x] 11.1 Add the new `test/*.test.ts` files to the `test` script file list in `app/apps/server/package.json`
    - Include the property, example, and smoke tests; keep slow/DB-dependent integration tests grouped appropriately
    - _Requirements: 6.1_

  - [x] 11.2 Final checkpoint - Ensure all tests pass
    - Run `npm test` + `npm run typecheck` in `apps/server`; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but property tests P1–P8 are the design's correctness guarantees and should land with the implementation.
- The `core/assemble.ts` invariant gate is never edited — only verified (tasks 9.4).
- All property tests carry the required tag comment: `// Feature: report-graph-normalization, Property <n>: <description>` plus a `Validates: Requirements …` reference.
- Integration tests (task 10) need a test Postgres; without `DATABASE_URL` they are skipped, while the property/example/smoke tests run fully on the offline-first memory path.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "3.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.1", "7.1"] },
    { "id": 3, "tasks": ["4.2", "6.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "9.1", "9.2", "9.3", "9.4", "9.5", "10.1", "10.2", "10.3"] },
    { "id": 4, "tasks": ["8.1", "8.2"] },
    { "id": 5, "tasks": ["11.1"] }
  ]
}
```
