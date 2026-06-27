# Requirements Document

## Introduction

Analysis reports are currently persisted only as a lossless JSONB blob in `analysis_reports.data`. The normalized `claims`, `citations`, and `perspective_links` tables exist in the schema (`db/migrations/001_init.sql`) but are reserved and unpopulated. Every Ground-News-style aggregate feature on the roadmap — blindspot clustering, "this claim appeared in N reports," topic pages — needs cross-report queries that JSONB cannot serve cheaply.

This feature implements the roadmap's committed **dual-write** decision (`f-Socials-roadmap.md` §7): keep the JSONB payload as the lossless render source of truth, AND populate the normalized rows for analytics and cross-report queries. The dual-write must land **before** the first aggregate feature, not after.

This is a backend / data-layer feature. New persistence goes through new `Repository` methods (memory + Postgres implementations), never ad-hoc queries. Parameterized SQL only. Migrations live in `app/db/migrations/*.sql` and are applied in order (the latest is `003_audit_records.sql`).

Two non-negotiables from the project compass constrain the whole feature:
- The invariant gate in `core/assemble.ts` must not be weakened — this work satisfies and verifies it, never edits it.
- f-Socials is a lens, not a judge: source-reliability tiers attach to sources and citations only, never to a creator. The normalized schema must carry no creator-reliability dimension.

## Glossary

- **Repository**: The persistence interface in `app/apps/server/src/infra/ports.ts` through which all data access flows.
- **Postgres_Repository**: The Postgres-backed `Repository` implementation in `app/apps/server/src/infra/postgres.ts`.
- **Memory_Repository**: The in-memory `Repository` implementation in `app/apps/server/src/infra/memory.ts`, used in the offline / zero-API-key path and in tests.
- **JSONB_Payload**: The complete `AnalysisReport` object stored losslessly in the `analysis_reports.data` column. The authoritative render source of truth.
- **Normalized_Rows**: The rows written to the `claims`, `citations`, and `perspective_links` tables that project a report's claims, citations, and perspectives for cross-report querying.
- **Dual_Write**: The mechanism that, on report persistence, writes the JSONB_Payload AND the Normalized_Rows for that report.
- **Normalized_Projection**: The deterministic mapping from an `AnalysisReport` object to its Normalized_Rows.
- **Migration_004**: The new ordered migration file (`app/db/migrations/004_*.sql`) added by this feature.
- **Backfill_Command**: The one-shot process that populates Normalized_Rows for reports that were persisted before this feature (JSONB only).
- **Invariant_Gate**: The report-readiness gate in `app/apps/server/src/core/assemble.ts`.
- **Neutrality_Check**: A static/property test asserting the absence of any creator-reliability dimension.

## Requirements

### Requirement 1: Dual-write on report persistence

**User Story:** As a developer building cross-report aggregate features, I want every saved report to also populate normalized rows, so that analytics queries run against indexed columns instead of parsing JSONB.

#### Acceptance Criteria

1. WHEN the Repository persists an AnalysisReport, THE Repository SHALL write the report's JSONB_Payload to `analysis_reports.data` AND populate the Normalized_Rows for that report.
2. THE Repository SHALL treat the JSONB_Payload as the authoritative render source of truth.
3. WHEN the Repository persists an AnalysisReport, THE Repository SHALL derive the Normalized_Rows from the same in-memory report object used to write the JSONB_Payload.
4. THE Repository SHALL expose the Dual_Write capability through a Repository method, and SHALL NOT perform report-graph persistence through ad-hoc queries outside the Repository.
5. WHEN an AnalysisReport reaches a persisted status, THE Repository SHALL perform at least one Dual_Write persistence operation for that report.

### Requirement 2: Normalized claim, citation, and perspective population

**User Story:** As a data consumer, I want each claim, citation, and perspective in a report represented as its own normalized row, so that cross-report queries can join and aggregate them.

#### Acceptance Criteria

1. WHEN the Dual_Write runs for a report, THE Repository SHALL insert one `claims` row for each Claim in the report.
2. WHEN the Dual_Write runs for a report, THE Repository SHALL insert one `citations` row for each Citation of each Claim, linked to that Claim's `claims` row.
3. WHEN the Dual_Write runs for a report, THE Repository SHALL insert one `perspective_links` row for each PerspectiveLink in the report.
4. THE Repository SHALL persist on each `claims` row the `report_id` of the report that produced it.
5. THE Repository SHALL persist on each `citations` row the `source_tier` carried by its originating Citation.
6. THE Repository SHALL preserve a stable linkage between each `claims` row and its originating Claim in the JSONB_Payload, so a normalized row can be traced back to the rendered claim.
7. WHERE a report contains a Claim with `evidenceStrength` equal to `none` and zero citations, THE Repository SHALL persist the `claims` row with zero linked `citations` rows.
8. WHERE a report contains a Claim with `evidenceStrength` other than `none`, THE Repository SHALL persist the `claims` row together with one linked `citations` row for each of that Claim's citations.

### Requirement 3: Faithful, lossless-enough projection (consistency between the two writes)

**User Story:** As a maintainer, I want the normalized rows to be a faithful projection of the JSONB payload, so that analytics never disagree with what the report renders.

#### Acceptance Criteria

1. FOR ALL persisted reports, THE Normalized_Projection SHALL produce exactly one `claims` row per Claim in the JSONB_Payload, with `claim_text`, `verifiability`, `evidence_strength`, `confidence`, `transcript_span`, and `source_basis` matching the corresponding Claim fields.
2. FOR ALL persisted reports, THE Normalized_Projection SHALL produce exactly one `citations` row per Citation in the JSONB_Payload, with `source_url`, `source_name`, `source_tier`, `excerpt`, and `supports` matching the corresponding Citation fields.
3. FOR ALL persisted reports, THE Normalized_Projection SHALL produce exactly one `perspective_links` row per PerspectiveLink in the JSONB_Payload, with `url`, `source_name`, `source_tier`, `issue_frame_label`, `divergence_score`, and `dehumanization_score` matching the corresponding PerspectiveLink fields.
4. WHEN the Normalized_Rows for a report are read back and compared to the report's JSONB_Payload, THE projected fields SHALL match for every claim, citation, and perspective (round-trip consistency property, verified by a fast-check property test of at least 100 runs).
5. WHERE a JSONB_Payload field has no corresponding normalized column (for example `evidenceDescription` on a Claim or `whyIncluded` on a PerspectiveLink), THE Repository SHALL retain that field in the JSONB_Payload, and THE Normalized_Projection SHALL omit only that field.

### Requirement 4: Failure and transactional semantics

**User Story:** As an operator, I want a normalized-write failure to never damage the served report, so that analytics is additive and the render path stays durable.

#### Acceptance Criteria

1. THE Dual_Write SHALL persist the JSONB_Payload such that a failure of the normalized write does not roll back, lose, or corrupt the JSONB_Payload.
2. WHEN the normalized write succeeds, THE Repository SHALL guarantee that the JSONB_Payload for that report is also persisted.
3. IF the normalized write fails, THEN THE Repository SHALL keep the report served and readable from its JSONB_Payload.
4. THE Repository SHALL write a single report's Normalized_Rows atomically, so that a reader never observes a partial set of Normalized_Rows for that report.
5. IF the normalized write fails, THEN THE Repository SHALL record the failure to the server log identifying the affected `report_id`.

### Requirement 5: Idempotent re-write

**User Story:** As a developer re-running or re-versioning a report, I want re-persisting it to refresh its normalized rows cleanly, so that no duplicate or stale rows accumulate.

#### Acceptance Criteria

1. WHEN a report that already has Normalized_Rows is persisted again, THE Repository SHALL replace that report's Normalized_Rows so they match the current JSONB_Payload.
2. WHEN a report is persisted again, THE Repository SHALL NOT leave duplicate or stale Normalized_Rows for that report, removing all duplicate Normalized_Rows for the report regardless of how they originated.
3. WHEN the same report is persisted two or more times in succession, THE resulting `claims`, `citations`, and `perspective_links` row counts for that report SHALL equal the counts produced by persisting the report once (idempotence property).

### Requirement 6: Repository methods across memory and Postgres drivers

**User Story:** As a developer relying on the offline-first path, I want both repository implementations to support dual-write, so that the zero-API-key path and tests stay green without a database.

#### Acceptance Criteria

1. THE Repository interface in `ports.ts` SHALL declare the Dual_Write capability used by both drivers.
2. THE Postgres_Repository SHALL implement the Normalized_Projection using parameterized SQL only.
3. THE Memory_Repository SHALL implement the same Dual_Write path so the zero-API-key offline path remains functional.
4. THE Memory_Repository SHALL expose its Normalized_Rows for test assertion without a database, mirroring the existing `disputes`, `flags`, and `auditRecords` accessors.
5. WHERE zero API keys are configured, THE server SHALL persist Normalized_Rows through the Memory_Repository.

### Requirement 7: Schema migration

**User Story:** As an operator, I want an ordered migration that prepares the reserved tables for population, so that `npm run migrate` brings the schema up to date non-destructively.

#### Acceptance Criteria

1. THE feature SHALL add migration file `app/db/migrations/004_*.sql`, applied by `npm run migrate` in order after `003_audit_records.sql`.
2. THE Migration_004 SHALL populate the existing reserved `claims`, `citations`, and `perspective_links` tables, adding only the columns, constraints, or indexes required to support idempotent Dual_Write and cross-report queries.
3. THE Migration_004 SHALL preserve existing data in `analysis_reports` and SHALL NOT break existing consumers of the `analysis_reports.data` JSONB_Payload.
4. THE Migration_004 SHALL use standard DDL and SHALL NOT introduce any creator-reliability column.

### Requirement 8: Backfill of existing reports

**User Story:** As an operator, I want existing JSONB-only reports backfilled into the normalized tables, so that analytics covers the full history, not only reports saved after this feature.

#### Acceptance Criteria

1. WHERE reports were persisted before this feature with only a JSONB_Payload, THE Backfill_Command SHALL populate their Normalized_Rows from the JSONB_Payload.
2. THE Backfill_Command SHALL be idempotent, so that running it repeatedly does not create duplicate Normalized_Rows.
3. WHERE a report already has Normalized_Rows, THE Backfill_Command SHALL skip that report and SHALL NOT create additional rows for it.
4. THE Backfill_Command SHALL read the JSONB_Payload as its source and SHALL NOT alter the JSONB_Payload.
5. IF a single report fails to backfill, THEN THE Backfill_Command SHALL continue processing the remaining reports and SHALL report the failed `report_id`.

### Requirement 9: No creator-reliability dimension (neutrality)

**User Story:** As a steward of the project compass, I want the normalized schema to carry no creator-reliability dimension, so that f-Socials stays a lens and never a judge of people.

#### Acceptance Criteria

1. THE normalized schema SHALL carry no column, field, or value expressing a reliability rating or truthfulness verdict attached to a content creator, channel, or author.
2. THE `source_tier` values SHALL attach only to `citations` and `perspective_links` rows, and SHALL NOT attach to a claim author or content creator.
3. THE Neutrality_Check SHALL assert the absence of any creator-reliability dimension in both the normalized schema and the Dual_Write code.

### Requirement 10: Invariant gate preserved

**User Story:** As a steward of the codified moat, I want the dual-write to leave the invariant gate untouched, so that the moat is only ever verified, never weakened.

#### Acceptance Criteria

1. THE feature SHALL NOT modify `app/apps/server/src/core/assemble.ts`.
2. THE Normalized_Rows SHALL reflect the gate-satisfying report state as produced (a Claim with `evidence_strength` other than `none` having at least one linked `citations` row; a Claim with `none` and zero citations remaining a valid state) without re-deriving or weakening the Invariant_Gate.

### Requirement 11: Cross-report queryability

**User Story:** As a developer of the first aggregate feature, I want the normalized rows to be queryable across reports, so that blindspot clustering and "this claim appeared in N reports" can be built without parsing JSONB.

#### Acceptance Criteria

1. THE normalized schema SHALL support querying `claims` and `citations` across multiple reports through indexed columns, without parsing the `analysis_reports.data` JSONB_Payload.
2. WHEN a cross-report aggregate query is run against the Normalized_Rows, THE schema SHALL allow grouping or counting claims and citations by report and by source through SQL joins on indexed columns.
