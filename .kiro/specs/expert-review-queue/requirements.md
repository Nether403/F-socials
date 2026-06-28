# Requirements Document

## Introduction

The dispute and flag **intake** already ships: `POST /analyses/:id/disputes` (anonymous, no user identity) and `POST /analyses/:id/flags` (authenticated; the named technique must match a framing technique the report surfaced). Both persist through `Repository.createDispute` / `Repository.createFlag` (memory + Postgres), and migration `002` added `disputes.claim_id`. The review **workflow** was intentionally left lagging the intake (`f-Socials-roadmap.md` §4).

This feature builds that workflow: a way for authorized reviewers to see incoming disputes and flags, triage them, claim or assign them, set a review status, and record a resolution. The resolution feeds the report's review status that the Methodology page already references ("who reviews reports and each review status") — the existing `Provenance.reviewStatus` field whose values are `ai-generated`, `expert-reviewed`, and `under-dispute`.

This is a full-stack feature: new authenticated server routes for listing and acting on the queue, reviewer authorization (who is a reviewer), new `Repository` methods plus a migration for review status / assignment / resolution, and a web reviewer UI surface. The anonymous dispute intake stays unauthenticated and unchanged.

Three non-negotiables from the project compass constrain the whole feature:
- **Lens, not a judge.** Source-reliability tiers attach to sources and citations only, never to a creator. No surface may display a verdict on truthfulness or a reliability rating tied to a person or channel. Reviewers surface framing and evidence; they never issue verdicts about a creator. When evidence is absent, the honest "no external review found" state stands.
- **The invariant gate** in `core/assemble.ts` must be satisfied by construction and only ever verified, never weakened or edited.
- **Persistence discipline.** New persistence goes through new `Repository` methods (memory + Postgres), parameterized SQL only, never ad-hoc queries. Migrations live in `app/db/migrations/*.sql` and apply in order (latest is `004_report_graph.sql`).

## Glossary

- **Repository**: The persistence interface in `app/apps/server/src/infra/ports.ts` through which all data access flows.
- **Postgres_Repository**: The Postgres-backed `Repository` implementation in `app/apps/server/src/infra/postgres.ts`.
- **Memory_Repository**: The in-memory `Repository` implementation in `app/apps/server/src/infra/memory.ts`, used in the offline / zero-API-key path and in tests.
- **Dispute**: An anonymous, identity-free challenge to a report, created by the existing `POST /analyses/:id/disputes` intake route.
- **Flag**: An authenticated challenge naming a framing technique the report surfaced, created by the existing `POST /analyses/:id/flags` intake route.
- **Review_Item**: A unit of review work derived from a single Dispute or a single Flag awaiting reviewer attention.
- **Review_Queue**: The server-side capability that lists Review_Items for reviewers.
- **Reviewer**: An authenticated user whose Supabase JWT `role` claim authorizes review actions.
- **Reviewer_Guard**: The authorization middleware that admits only a Reviewer to review routes, layered on top of `requireAuth`.
- **Review_Status**: The lifecycle status of a Review_Item, one of `pending`, `in_review`, or `resolved`.
- **Review_Resolution**: The record a Reviewer commits when resolving a Review_Item, comprising a Resolution_Outcome and an optional reviewer note.
- **Resolution_Outcome**: A bounded, enumerated description of the review outcome that surfaces framing or evidence only and carries no truthfulness verdict and no creator-reliability rating.
- **Report_Review_Status**: The existing `Provenance.reviewStatus` field on an AnalysisReport (`ai-generated` | `expert-reviewed` | `under-dispute`).
- **Reviewer_Console**: The web reviewer UI surface in `app/apps/web`, reached through a hash route.
- **Migration_005**: The new ordered migration file (`app/db/migrations/005_*.sql`) added by this feature.
- **Invariant_Gate**: The report-readiness gate in `app/apps/server/src/core/assemble.ts`.
- **Neutrality_Check**: A static / property test asserting the absence of any creator-reliability dimension or truthfulness verdict across the review schema, routes, resolution vocabulary, and UI.

## Requirements

### Requirement 1: Reviewer authorization

**User Story:** As a project steward, I want only authorized reviewers to access the review workflow, so that the queue and its actions are not exposed to anonymous or ordinary authenticated users.

#### Acceptance Criteria

1. WHEN a request to a review route carries a JWT that is valid (signature verified against the configured Supabase JWT secret, unexpired, and containing a subject identifier) and whose `role` claim identifies the user as a Reviewer, THE Reviewer_Guard SHALL forward the request to the route handler.
2. IF a request to a review route carries no Authorization bearer token, THEN THE Reviewer_Guard SHALL reject the request with HTTP status 401 and SHALL NOT invoke the route handler.
3. IF a request to a review route carries a bearer token that fails validation (signature mismatch, expired, or missing subject identifier), THEN THE Reviewer_Guard SHALL reject the request with HTTP status 401 and SHALL NOT invoke the route handler.
4. IF a request to a review route carries a valid JWT whose `role` claim does not identify the user as a Reviewer, THEN THE Reviewer_Guard SHALL reject the request with HTTP status 403 and SHALL NOT invoke the route handler.
5. THE Reviewer_Guard SHALL apply to every review route that lists or mutates Review_Items.
6. WHERE the Reviewer role configuration is absent, THE server SHALL deny every request to all review routes (fail closed) without blocking startup and SHALL emit a startup warning naming the missing Reviewer role configuration.

### Requirement 2: List the review queue

**User Story:** As a Reviewer, I want to see incoming disputes and flags in one queue, so that I can triage what needs attention.

#### Acceptance Criteria

1. WHEN a Reviewer requests the Review_Queue, THE Review_Queue SHALL return exactly one Review_Item for each persisted Dispute and exactly one Review_Item for each persisted Flag, with no duplicate and no omitted item.
2. THE Review_Queue SHALL include on each Review_Item the originating report id, the item kind (`dispute` or `flag`), the Review_Status, the item's creation timestamp, and the assigned Reviewer identifier when assigned or a null assigned Reviewer identifier when unassigned.
3. WHEN the Review_Queue returns a dispute-derived Review_Item, THE Review_Queue SHALL include the dispute reason and SHALL include the claim id only when the Dispute carries one; WHEN the Review_Queue returns a flag-derived Review_Item, THE Review_Queue SHALL include the flagged technique and SHALL include the note only when the Flag carries one.
4. WHERE the requester supplies a Review_Status filter, THE Review_Queue SHALL return only Review_Items whose Review_Status equals the supplied value.
5. IF the requester supplies a Review_Status filter value that is not one of the enumerated Review_Status values, THEN THE Review_Queue SHALL reject the request with an error indicating the filter value is invalid and SHALL return no Review_Items.
6. THE Review_Queue SHALL order returned Review_Items by creation timestamp ascending, and WHERE two Review_Items share the same creation timestamp, THE Review_Queue SHALL order them by originating report id ascending.
7. WHERE no Review_Items match the request, THE Review_Queue SHALL return an empty list with HTTP status 200.

### Requirement 3: Claim and assign a review item

**User Story:** As a Reviewer, I want to claim a review item, so that two reviewers do not duplicate work on the same dispute or flag.

#### Acceptance Criteria

1. WHEN a Reviewer claims a Review_Item whose Review_Status is `pending`, THE Repository SHALL, in a single atomic operation, set that Review_Item's assigned Reviewer to the claiming Reviewer and set its Review_Status to `in_review`.
2. IF a Reviewer attempts to claim a Review_Item already assigned to a different Reviewer, THEN THE Repository SHALL reject the claim, SHALL leave the existing assigned Reviewer and Review_Status unchanged, and SHALL return an error indicating the Review_Item is already claimed.
3. IF a Reviewer attempts to claim a Review_Item whose Review_Status is `resolved`, THEN THE Repository SHALL reject the claim, SHALL leave the Review_Status as `resolved` with its assignment unchanged, and SHALL return an error indicating the Review_Item is already resolved.
4. WHEN the same Reviewer claims the same `pending` Review_Item two or more times in succession, THE resulting assigned Reviewer and Review_Status SHALL equal the result of claiming it exactly once (idempotent claim), with no additional state change on the second and subsequent claims.
5. WHEN two or more Reviewers claim the same `pending` Review_Item concurrently, THE Repository SHALL grant the claim to exactly one Reviewer and SHALL reject every other concurrent claim with an error indicating the Review_Item is already claimed.
6. IF a Review_Item is referenced by an identifier that matches no persisted Review_Item, THEN THE Repository SHALL reject the request, SHALL make no state change, and SHALL return an error indicating the Review_Item does not exist.
7. WHEN a Reviewer releases a Review_Item currently assigned to that same Reviewer, THE Repository SHALL clear the assigned Reviewer and set its Review_Status back to `pending`.
8. IF a Reviewer attempts to release a Review_Item that is not assigned to that Reviewer, THEN THE Repository SHALL reject the release, SHALL leave the existing assigned Reviewer and Review_Status unchanged, and SHALL return an error indicating the Reviewer does not hold the Review_Item.

### Requirement 4: Record a review resolution

**User Story:** As a Reviewer, I want to record the outcome of my review, so that the disposition of a dispute or flag is captured and auditable.

#### Acceptance Criteria

1. WHEN a Reviewer submits a Review_Resolution for an existing Review_Item, THE Repository SHALL persist the Resolution_Outcome, the optional reviewer note, the resolving Reviewer identifier, and an ISO 8601 UTC resolution timestamp, and SHALL set the Review_Item's Review_Status to `resolved`.
2. THE server SHALL accept a Review_Resolution only WHERE the submitted Resolution_Outcome is exactly one of the enumerated Resolution_Outcome values.
3. IF a Review_Resolution is submitted with a Resolution_Outcome outside the enumerated set, or with a reviewer note exceeding 2,000 characters, THEN THE server SHALL reject the submission with HTTP status 400 via zod validation at the trust boundary, SHALL return an error indicating which field was invalid, and SHALL NOT persist any part of the submission.
4. IF a Review_Resolution is submitted for a Review_Item identifier that does not exist, THEN THE server SHALL reject the submission with an error indicating the Review_Item was not found and SHALL NOT create a Review_Item.
5. WHEN a Reviewer submits a Review_Resolution for a Review_Item whose Review_Status is already `resolved`, THE Repository SHALL replace the prior Review_Resolution with the submitted one, SHALL retain Review_Status as `resolved`, and SHALL NOT create a duplicate Review_Item.
6. THE Repository SHALL store with each Review_Resolution the identifier of the originating Dispute or Flag, such that every persisted Review_Resolution resolves to exactly one originating intake record.

### Requirement 5: Feed the report review status

**User Story:** As a reader of a report, I want the report's review status to reflect outstanding and completed expert review, so that the Methodology page's "each review status" is accurate.

#### Acceptance Criteria

1. WHILE at least one Review_Item for a report has a Review_Status of `pending` or `in_review`, THE Report_Review_Status for that report SHALL be `under-dispute`.
2. WHEN a Reviewer resolves a Review_Item for a report and no other Review_Item for that report has a Review_Status of `pending` or `in_review`, THE Report_Review_Status for that report SHALL become `expert-reviewed`.
3. THE Report_Review_Status SHALL take only the existing values `ai-generated`, `expert-reviewed`, and `under-dispute`, and THE feature SHALL NOT introduce a new report review-status value.
4. WHEN the feature sets a Report_Review_Status, THE feature SHALL leave the report's claims, framing signals, citations, evidence strengths, and confidence unchanged.
5. WHERE a report has no associated Review_Item, THE Report_Review_Status SHALL remain the value the report already carries.

### Requirement 6: Repository methods across memory and Postgres drivers

**User Story:** As a developer relying on the offline-first path, I want both repository implementations to support the review workflow, so that the zero-API-key path and tests stay green without a database.

#### Acceptance Criteria

1. THE Repository interface in `ports.ts` SHALL declare a distinct method for each of the following review operations: list Review_Items, claim a Review_Item, release a Review_Item, and record a Review_Resolution.
2. THE Postgres_Repository SHALL implement every review method declared in criterion 1 using parameterized SQL, passing all caller-supplied values as bound parameters and never via string interpolation.
3. WHEN any review method is invoked with zero configured API keys and no database connection available, THE Memory_Repository SHALL service that method and return a result without raising an error, so the offline path remains operable.
4. THE Memory_Repository SHALL expose its review state through a public read accessor that is readable without a database, mirroring the existing `disputes`, `flags`, and `auditRecords` accessors.
5. THE feature SHALL perform every review-state read and write exclusively through Repository methods, and SHALL NOT issue review-state queries outside the Repository.
6. IF a claim operation targets a Review_Item that is already claimed, THEN THE Repository SHALL reject the claim, leave the existing claim unchanged, and signal to the caller that the Review_Item is unavailable.
7. IF a release or record-resolution operation targets a Review_Item that is not currently claimed, THEN THE Repository SHALL leave review state unchanged and signal to the caller that the operation did not apply.
8. WHEN a list Review_Items operation matches no Review_Items for the requested state, THE Repository SHALL return an empty collection rather than raising an error.

### Requirement 7: Schema migration

**User Story:** As an operator, I want an ordered migration that adds the review workflow state, so that `npm run migrate` brings the schema up to date non-destructively.

#### Acceptance Criteria

1. THE feature SHALL add a migration file named `app/db/migrations/005_*.sql` whose numeric prefix `005` orders it immediately after `004_report_graph.sql`, and `npm run migrate` SHALL apply pending migration files in ascending numeric-prefix order.
2. THE Migration_005 SHALL add the columns, constraints, or tables required to persist, for each Dispute and each Flag, a Review_Status constrained to the enumerated values `pending`, `in_review`, and `resolved`, an assigned Reviewer identifier that is null when unassigned, and a Review_Resolution (Resolution_Outcome, optional reviewer note, resolving Reviewer identifier, and resolution timestamp) that is null until a resolution is recorded.
3. WHEN `npm run migrate` applies Migration_005, THE Migration_005 SHALL preserve every existing `disputes` and `flags` row without deleting, truncating, or overwriting their existing column values, and SHALL NOT alter the request or response contract of the existing dispute and flag intake routes.
4. THE Migration_005 SHALL use standard DDL statements and parameterized-query-compatible column types and constraints, and SHALL NOT introduce any column, constraint, or enumerated value expressing a creator-reliability rating or a truthfulness verdict.
5. WHEN `npm run migrate` applies Migration_005, THE Migration_005 SHALL set the Review_Status of every existing Dispute and Flag row to `pending`.
6. IF `npm run migrate` is run again after Migration_005 has already been applied, THEN THE migration runner SHALL NOT re-apply Migration_005 and SHALL leave all review-workflow columns, constraints, and existing row values unchanged.

### Requirement 8: Anonymous dispute intake preserved

**User Story:** As an anonymous reader, I want to keep challenging reports without an account, so that the lens stays open to everyone.

#### Acceptance Criteria

1. THE feature SHALL keep `POST /analyses/:id/disputes` open to a request that carries no Supabase JWT, SHALL accept such a request without rejecting it for missing or absent authentication, and SHALL NOT add any authentication or Reviewer authorization requirement to dispute intake.
2. THE feature SHALL NOT record, store, or expose any submitter identity for a Dispute — including account identifier, author or creator name, IP address, or session token — through any review route, Review_Item, or Reviewer_Console surface.
3. THE feature SHALL keep `POST /analyses/:id/flags` behind `requireAuth` and SHALL keep the existing rule that the flag's named technique must match a framing technique the report surfaced.
4. WHEN a Dispute or a Flag is created through the existing intake routes, THE Repository SHALL make it retrievable as a Review_Queue Review_Item whose Review_Status is `pending`.
5. IF a request to `POST /analyses/:id/flags` carries no valid authentication, THEN THE feature SHALL reject the request with HTTP status 401 and SHALL NOT persist a Flag.
6. IF a Flag submission names a technique that does not match any framing technique the report surfaced, THEN THE feature SHALL reject the submission with HTTP status 400 and SHALL NOT persist a Flag.

### Requirement 9: Neutrality — no creator dimension, no truthfulness verdict

**User Story:** As a steward of the project compass, I want the review workflow to surface framing and evidence only, so that f-Socials stays a lens and never becomes a judge of people.

#### Acceptance Criteria

1. THE review schema, review routes, Resolution_Outcome vocabulary, and Reviewer_Console SHALL carry no column, field, enumerated value, or display label that expresses a reliability rating or a truthfulness verdict attached to a content creator, channel, or author.
2. WHERE the review schema or Reviewer_Console surfaces a source-reliability tier, THE feature SHALL bind that tier to a source or citation only and SHALL NOT bind it to a content creator, channel, or author.
3. THE Resolution_Outcome of a Review_Resolution SHALL be drawn from the bounded enumerated Resolution_Outcome set, SHALL describe the review of the report's framing or evidence only, and SHALL NOT assert that the analyzed content is true or false.
4. WHERE a report has no external evidence, THE Reviewer_Console SHALL present a visible, text-labeled "no external review found" state and SHALL NOT substitute a reviewer verdict for the absent evidence.
5. THE Neutrality_Check SHALL assert the absence of any creator-reliability dimension and any truthfulness-verdict dimension across the review schema, the review routes, the Resolution_Outcome vocabulary, and the Reviewer_Console.
6. WHEN the Neutrality_Check is executed, THE Neutrality_Check SHALL fail if any creator-reliability dimension or truthfulness-verdict dimension is present in the review schema, the review routes, the Resolution_Outcome vocabulary, or the Reviewer_Console, and SHALL pass otherwise.

### Requirement 10: Invariant gate preserved

**User Story:** As a steward of the codified moat, I want the review workflow to leave the invariant gate untouched, so that the moat is only ever verified, never weakened.

#### Acceptance Criteria

1. THE feature SHALL NOT modify, replace, or delete `app/apps/server/src/core/assemble.ts`, including its gate conditions (no claim asserts an evidence strength it cannot cite, every framing signal has an evidenced example, at least one claim was extracted) and its confidence-floor threshold.
2. WHEN the feature sets a Report_Review_Status, THE report's gate-relevant fields — each claim's evidenceStrength and citation set, each framing signal's example, the extracted claim count, and the confidence value — SHALL remain identical to the values the report was assembled with.
3. THE feature SHALL treat the Invariant_Gate as verify-only, MAY re-run the gate, and SHALL NOT re-derive, relax, add, remove, or reorder any gate condition or threshold.
4. WHEN the gate is re-evaluated after a Report_Review_Status change, THE gate SHALL yield the same readiness status (`ready` or `needs_review`) and the same reasons as before the change.
5. IF setting a Report_Review_Status would require altering any gate-relevant field, THEN THE feature SHALL NOT apply the status change and SHALL leave the report's gate state and readiness status unchanged.

### Requirement 11: Web reviewer console

**User Story:** As a Reviewer, I want a web surface to work the queue, so that I can triage, claim, and resolve items without crafting raw API calls.

#### Acceptance Criteria

1. THE Reviewer_Console SHALL be reachable through a hash route and SHALL list Review_Items showing the report context, the dispute reason or flagged technique, the Review_Status, and the assignee, displaying an explicit "unassigned" label when no Reviewer is assigned.
2. THE Reviewer_Console SHALL provide keyboard-operable controls to claim a Review_Item, release a Review_Item, and submit a Review_Resolution.
3. THE Reviewer_Console SHALL accompany every color-coded Review_Status or outcome indicator with a text label (color-never-alone) and SHALL expose ARIA descriptions for interactive controls.
4. WHILE the viewport width is 768 pixels or less, THE Reviewer_Console SHALL render in a single column.
5. WHERE the Review_Queue returns no items, THE Reviewer_Console SHALL present an explicit empty-queue state rather than a blank or partial view.
6. IF the review routes are unreachable or respond with an authorization error, THEN THE Reviewer_Console SHALL present an error or sign-in state with a retry or back control rather than a partial view.
7. WHILE a Review_Queue or review-action request is in flight, THE Reviewer_Console SHALL present a loading state rather than a partial view.
8. WHEN a claim, release, or Review_Resolution action succeeds, THE Reviewer_Console SHALL update the displayed Review_Status and assignee to reflect the new state.
9. IF a claim, release, or Review_Resolution action fails (including when the Review_Item was already claimed by another Reviewer or its status conflicts), THEN THE Reviewer_Console SHALL present an error indication, SHALL leave the displayed Review_Item unchanged, and SHALL keep its controls keyboard-operable for retry.

### Requirement 12: Tested review logic

**User Story:** As a maintainer, I want the review workflow's core logic covered by property-based tests, so that the queue, claim, resolution, and neutrality rules stay correct under change.

#### Acceptance Criteria

1. THE feature SHALL cover the claim idempotence rule (Requirement 3.4) with a fast-check property test of at least 100 runs, asserting that when the same Reviewer claims a `pending` Review_Item one or more times in succession, the assigned Reviewer equals the claiming Reviewer and the Review_Status equals `in_review`, identical to the result of a single claim.
2. THE feature SHALL cover the resolution-then-status rule (Requirements 4.1 and 5.2) with a fast-check property test of at least 100 runs, asserting that a recorded Review_Resolution sets the Review_Item's Review_Status to `resolved`, that the Report_Review_Status is `under-dispute` while any sibling Review_Item remains unresolved, and that it becomes `expert-reviewed` once all Review_Items for the report are `resolved`.
3. THE feature SHALL cover the queue projection rule (Requirements 2.1 through 2.3) with a fast-check property test of at least 100 runs, asserting exactly one Review_Item per persisted Dispute and Flag and that each field listed in Requirements 2.2 and 2.3 on a projected Review_Item equals the corresponding source Dispute or Flag value.
4. THE feature SHALL implement server property tests under `node:test` with `node:assert`, add each new server test file to the explicit server test file list in `package.json`, and place web tests under Vitest.
5. THE Neutrality_Check (Requirement 9.5 and 9.6) SHALL run in the standard test run and SHALL fail that run if any creator-reliability dimension or truthfulness verdict appears in the review schema, the review routes, the Resolution_Outcome vocabulary, or the Reviewer_Console.
