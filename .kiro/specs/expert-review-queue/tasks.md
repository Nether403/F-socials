# Implementation Plan: Expert Review Queue

## Overview

This plan builds the review **workflow** on top of the existing dispute/flag **intake**, in dependency order: shared types and the neutrality-safe outcome vocabulary first, then the additive migration, then the Repository contract and the pure report-status derivation, then both repository implementations (memory before Postgres), then HTTP validation, the reviewer guard, and the routes, then the derive-on-read overlay, and finally the web Reviewer Console. Property-based tests (fast-check, ≥100 runs) sit next to the pure/state-machine logic they validate; example, edge, authorization, migration, neutrality-static, and UI tests cover the rest. The report is never written — review status is derived on read — so the invariant gate is preserved by construction.

Implementation language: **TypeScript** (per the existing codebase and design).

## Tasks

- [x] 1. Establish shared review types and the resolution vocabulary
  - [x] 1.1 Add review types to `app/apps/server/src/types.ts`
    - Add `ReviewKind` (`'dispute' | 'flag'`), `ReviewLifecycle` (`'pending' | 'in_review' | 'resolved'`), and `ResolutionOutcome` as union types (no TS enums, matching file convention)
    - Add the `ReviewItem`, `ReviewResolutionInput`, and `ReviewActionResult` shapes from design §5
    - Leave `Provenance.reviewStatus` unchanged — introduce no new report review-status value
    - _Requirements: 5.3, 6.1_

  - [x] 1.2 Create the resolution vocabulary at `app/apps/server/src/core/reviewOutcome.ts`
    - Export `RESOLUTION_OUTCOMES` as a `const` tuple of the seven framing/evidence-only values from design §3 and derive `ResolutionOutcome` from it
    - Include no value expressing a creator-reliability rating or truthfulness verdict
    - Add a `ponytail:` self-check at the bottom asserting the set is non-empty and contains no banned token
    - _Requirements: 4.2, 9.1, 9.3_

- [x] 2. Add the schema migration
  - [x] 2.1 Create `app/db/migrations/005_review_workflow.sql`
    - Add the `review_status_kind` and `resolution_outcome` enum types behind re-run-safe guards (DO/EXCEPTION duplicate_object)
    - Add the six additive columns to both `disputes` and `flags` with `IF NOT EXISTS`; `review_status NOT NULL DEFAULT 'pending'`; `assigned_reviewer` nullable; resolution columns nullable
    - Add the review-status and report indexes; leave legacy `status`/`resolution`/`resolved_at` untouched; introduce no creator-reliability or truthfulness column
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 9.1_

  - [x] 2.2 Write the migration integration test `app/apps/server/test/review.migration.test.ts`
    - Mirror `reportGraph.migration.test.ts`: assert 005 applies, adds columns/constraints, preserves seeded rows, sets existing rows to `pending`, and is a no-op on re-run (runs under `test:integration` against Postgres)
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6_

- [x] 3. Define the Repository contract and the pure report-status derivation
  - [x] 3.1 Declare the four review methods on the `Repository` interface in `app/apps/server/src/infra/ports.ts`
    - `listReviewItems(filter?)`, `claimReviewItem(id, reviewer)`, `releaseReviewItem(id, reviewer)`, `recordReviewResolution(id, resolution)` returning `Promise<ReviewActionResult>` / `Promise<ReviewItem[]>`
    - Leave `createDispute`/`createFlag` signatures unchanged
    - _Requirements: 6.1, 8.1, 8.3_

  - [x] 3.2 Create the pure derivation at `app/apps/server/src/core/reportReviewStatus.ts`
    - `deriveReportReviewStatus(current, itemStatuses)`: empty → unchanged `current`; any non-`resolved` → `under-dispute`; all `resolved` → `expert-reviewed`; never mutates a report, never reads gate-relevant fields, never returns a new status value
    - Add a `ponytail:` self-check covering the three branches
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [x] 3.3 Write property test `app/apps/server/test/review.statusDerivation.test.ts`
    - **Property 7: Report-review-status derivation is total and bounded**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5**

- [x] 4. Implement the in-memory Repository
  - [x] 4.1 Add review fields and create-time defaults in `app/apps/server/src/infra/memory.ts`
    - Extend the `disputes`/`flags` row shapes with `reviewStatus`, `assignedReviewer`, and `resolution`; have `createDispute`/`createFlag` initialize `pending` / `null` / `null`
    - Keep the existing public `disputes`/`flags` accessors so review state is readable offline
    - _Requirements: 6.3, 6.4, 8.4_

  - [x] 4.2 Implement the four review methods in `app/apps/server/src/infra/memory.ts`
    - `listReviewItems`: project both arrays to `ReviewItem` (dispute → `reason`/optional `claimId`, flag → `technique`/optional `note`, no submitter identity), apply optional status filter, sort by `createdAt` asc then `reportId` asc, return `[]` when empty
    - `claimReviewItem`: atomic compare-and-set — `pending`→grant; same reviewer holding→idempotent ok; different holder→`conflict`; `resolved`→`conflict`; unknown id→`not_found`
    - `releaseReviewItem`: holder→clear+`pending` ok; otherwise `not_actionable`
    - `recordReviewResolution`: any existing id→store/overwrite resolution + set `resolved` (no prior claim required, no duplicate); unknown id→`not_found`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.4, 4.5, 4.6, 6.6, 6.7, 6.8_

  - [x] 4.3 Create the shared arbitrary generator `app/apps/server/test/review.arb.ts`
    - Random Disputes/Flags with review state (mirror `reportGraph.arb.ts`), including timestamp-tie cases; add a guarded self-check at the bottom
    - _Requirements: 12.4_

  - [x] 4.4 Write property test `app/apps/server/test/review.projection.test.ts`
    - **Property 1: Queue projection fidelity** (one item per row, every field equals source, no submitter identity, fresh intakes `pending`)
    - **Validates: Requirements 2.1, 2.2, 2.3, 4.6, 8.2, 8.4**

  - [x] 4.5 Write property test `app/apps/server/test/review.listContract.test.ts`
    - **Property 2: List filter and ordering contract**
    - **Validates: Requirements 2.4, 2.6**

  - [x] 4.6 Write property test `app/apps/server/test/review.claimIdempotent.test.ts`
    - **Property 3: Claim idempotence**
    - **Validates: Requirements 3.1, 3.4, 12.1**

  - [x] 4.7 Write property test `app/apps/server/test/review.claimExclusive.test.ts`
    - **Property 4: Claim exclusivity under contention** (exactly one winner, others `conflict`, losers leave state unchanged)
    - **Validates: Requirements 3.2, 3.5, 6.6**

  - [x] 4.8 Write property test `app/apps/server/test/review.releaseRoundTrip.test.ts`
    - **Property 5: Claim/release round-trip**
    - **Validates: Requirements 3.7**

  - [x] 4.9 Write property test `app/apps/server/test/review.resolutionStatus.test.ts`
    - **Property 6: Resolution drives item and report status** (resolved set, replace-on-repeat, derived report status across siblings)
    - **Validates: Requirements 4.1, 4.5, 5.1, 5.2, 12.2**

  - [x] 4.10 Write edge/offline tests `app/apps/server/test/review.edges.test.ts` and `app/apps/server/test/review.offline.test.ts`
    - Edges: resolved/unknown/non-holder branches and empty list (2.7, 3.3, 3.6, 3.8, 6.7, 6.8); Offline: every method runs on `InMemoryRepository` with zero keys and review fields readable via public accessors (6.3, 6.4)
    - _Requirements: 2.7, 3.3, 3.6, 3.8, 6.3, 6.4, 6.7, 6.8_

- [x] 5. Implement the Postgres Repository
  - [x] 5.1 Implement the four review methods in `app/apps/server/src/infra/postgres.ts`
    - Parameterized SQL only (all caller values bound, no interpolation): conditional compare-and-set `UPDATE` for claim/release (predicate grants one concurrent winner and makes same-reviewer re-claim a no-op success); `UNION ALL` projection with `ORDER BY created_at ASC, report_id ASC` for list; resolution write matches any row by id and sets `resolved`
    - On `rowCount = 0` for claim/release, run a follow-up parameterized `SELECT` to classify `not_found` vs `conflict`/`not_actionable`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.4, 4.5, 6.2_

- [x] 6. Checkpoint — repository and core logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add HTTP validation schemas
  - [x] 7.1 Add review zod schemas to `app/apps/server/src/http/validation.ts`
    - `reviewQueueQuerySchema` (optional `status` enum) and `reviewResolutionSchema` (`outcome` from `RESOLUTION_OUTCOMES`, optional `note` ≤ 2000 chars)
    - _Requirements: 2.5, 4.2, 4.3_

- [x] 8. Add reviewer authorization
  - [x] 8.1 Add `reviewerRole` config in `app/apps/server/src/config.ts` and `.env.example`
    - Read `REVIEWER_ROLE`, defaulting to `''`
    - _Requirements: 1.6_

  - [x] 8.2 Implement `reviewerGuard` in `app/apps/server/src/http/auth.ts`
    - Layer after `requireAuth`: empty role → `403 reviewer_role_not_configured` (fail closed); `req.user.role !== role` → `403 not_a_reviewer`; otherwise forward
    - _Requirements: 1.1, 1.4, 1.5, 1.6_

  - [x] 8.3 Emit the fail-closed startup warning in `app/apps/server/src/compose.ts` (or `index.ts`)
    - When `REVIEWER_ROLE` is empty, log the degrade-and-warn line without aborting startup
    - _Requirements: 1.6_

  - [x] 8.4 Write `app/apps/server/test/review.authz.test.ts` and `app/apps/server/test/review.failClosed.test.ts`
    - Authz: valid reviewer 200, no token 401, bad token 401, non-reviewer 403, every review route guarded (use the `req.user` stub pattern from `flag.persist.test.ts`); FailClosed: empty `REVIEWER_ROLE` denies all and startup does not abort
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 9. Add the review routes
  - [x] 9.1 Add the four review routes under `/api/v1/review` in `app/apps/server/src/http/routes.ts`
    - `GET /review/queue` (optional `?status=`), `POST /review/items/:id/claim`, `POST /review/items/:id/release`, `POST /review/items/:id/resolution`, all behind `requireAuth + reviewerGuard`
    - Parse `:id` as `"{kind}:{sourceId}"` (malformed → `400 invalid_review_item_id`); validate with the §7 schemas; map `ReviewActionResult.reason` to `404`/`409`/`409 not_actionable`
    - _Requirements: 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 3.1, 3.2, 3.3, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 9.2 Write `app/apps/server/test/review.validation.test.ts`
    - Invalid filter and out-of-set/oversized resolution rejected at the boundary with `400` and nothing persisted; each enumerated outcome accepted
    - _Requirements: 2.5, 4.2, 4.3_

- [x] 10. Overlay the derived report review status on read
  - [x] 10.1 Overlay `deriveReportReviewStatus` onto the outgoing `provenance.reviewStatus` in the report read path (`GET /analyses/:id`, `GET /r/:slug`) in `app/apps/server/src/http/routes.ts`
    - Read this report's review items via the Repository, derive the status, set it on the response object only; never rewrite the persisted report
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 10.1, 10.3_

  - [x] 10.2 Write property test `app/apps/server/test/review.gatePreserve.test.ts`
    - **Property 8: Invariant-gate preservation under overlay** (reuse `gateValidReportArbitrary` from `test/reportGraph.arb.ts`)
    - **Validates: Requirements 5.4, 10.2, 10.4, 10.5**

- [x] 11. Enforce neutrality
  - [x] 11.1 Write property test `app/apps/server/test/review.neutrality.prop.test.ts`
    - **Property 9: Neutrality is enforced and the outcome vocabulary is framing/evidence-only**
    - **Validates: Requirements 9.3, 9.6, 12.5**

  - [x] 11.2 Write static scan `app/apps/server/test/review.neutralityStatic.test.ts`
    - Mirror `reportGraph.neutralityStatic.test.ts`: scan migration SQL, route fields, the outcome vocab, and console labels for banned creator-reliability/truthfulness tokens
    - _Requirements: 7.4, 9.1, 9.2, 9.5_

- [x] 12. Build the web Reviewer Console
  - [x] 12.1 Add review client functions to `app/apps/web/src/api/client.ts`
    - `getReviewQueue(status?)`, `claimReviewItem(id)`, `releaseReviewItem(id)`, `resolveReviewItem(id, { outcome, note })`, mirroring the existing `submitDispute`/`submitFlag` fetch+throw style
    - _Requirements: 11.1, 11.8_

  - [x] 12.2 Create `app/apps/web/src/components/ReviewerConsole.tsx`
    - List items (report context, dispute reason / flagged technique, status, assignee with explicit "unassigned" label); keyboard-operable claim/release/resolve controls with ARIA descriptions; color-never-alone; `@media (max-width: 768px)` single column; distinct loading / empty-queue / error+sign-in states; success updates status+assignee; failure leaves item unchanged with retry-able controls; labeled "no external review found" state when a report has no external evidence
    - _Requirements: 9.4, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

  - [x] 12.3 Wire the `#/review` hash route into `app/apps/web/src/App.tsx`
    - Add to the `View` union and hash handler (hash routing only, no router dep)
    - _Requirements: 11.1_

  - [x] 12.4 Write `app/apps/web/src/components/ReviewerConsole.test.tsx`
    - List + "unassigned" (11.1), keyboard (11.2), color-never-alone + ARIA (11.3), single-column ≤768px (11.4), empty (11.5), error/sign-in (11.6), loading (11.7), success update (11.8), failure-unchanged (11.9)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

  - [x] 12.5 Write `app/apps/web/src/components/ReviewerConsole.honestAbsence.test.tsx`
    - No-evidence report renders the labeled "no external review found" state with no substitute verdict
    - _Requirements: 9.4_

- [x] 13. Register new server test files
  - [x] 13.1 Add every new `test/review.*.test.ts` file to the explicit server test file list in `app/apps/server/package.json`
    - Keep slow migration/integration files under the separate `test:integration` script; web tests are auto-discovered by `vitest run`
    - _Requirements: 12.4_

- [x] 14. Final checkpoint — full verification
  - Ensure all tests pass, ask the user if questions arise. Run `npm test` + `npm run typecheck` in `apps/server` and `npx vitest run` + `tsc -b` in `apps/web`.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP, but Requirement 12 mandates the property tests (3.3, 4.4–4.9, 10.2, 11.1) and the neutrality check (11.1/11.2), so they should not be skipped for a complete delivery.
- Each task references specific requirements (granular sub-requirements) for traceability.
- Property tests use fast-check at ≥100 runs, are tagged `// Feature: expert-review-queue, Property <n>: …`, and carry a `Validates:` reference, per the design's Correctness Properties and Testing Strategy.
- The report is never written; review status is derived on read, so the invariant gate in `core/assemble.ts` is preserved by construction (Requirement 10) and only verified by Property 8.
- Memory repository is implemented before Postgres so the offline-first path and property tests stay green without a database.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["3.1", "3.2", "7.1", "8.1", "2.2"] },
    { "id": 2, "tasks": ["4.1", "8.2", "3.3"] },
    { "id": 3, "tasks": ["4.2", "5.1", "8.3"] },
    { "id": 4, "tasks": ["4.3", "9.1"] },
    { "id": 5, "tasks": ["4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "9.2", "8.4", "10.1"] },
    { "id": 6, "tasks": ["10.2", "11.1", "11.2", "12.1"] },
    { "id": 7, "tasks": ["12.2"] },
    { "id": 8, "tasks": ["12.3", "12.4", "12.5"] },
    { "id": 9, "tasks": ["13.1"] }
  ]
}
```
