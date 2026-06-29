# Implementation Plan: Institutional Workspace

## Overview

This plan implements the institutional-workspace slice in incremental, integration-first steps, following the `accounts-save-history` precedent exactly: the server persistence layer first (port → in-memory → Postgres → additive migration `007`), then the `requireAuth`-gated routes plus the single `loadMembership` authorization guard that consumes it, then the web session-aware API calls and the Workspace_View surfaces, finishing by wiring routing and session handling into the existing hash router. Each step builds on the previous one and ends wired into the app — no orphaned code. Property tests track the design's thirteen Correctness Properties; example/integration/smoke tests cover HTTP gating, error paths, UI transitions, the migration, and the static architectural rules.

Language: TypeScript (server ESM with extensionless relative imports; React 19 + Vite on the web), matching the existing monorepo. The Invariant_Gate (`core/assemble.ts`) is read-only and only ever verified, never edited (Req 11).

## Tasks

- [x] 1. Add Workspace persistence types and methods to the Repository port
  - In `app/apps/server/src/infra/ports.ts`, add the `WorkspaceRole` union and the lens-safe projection types `WorkspaceSummary`, `Membership`, `SharedCollection`, `CollectionItemEntry`, `Annotation` (identifiers, names, role, timestamps, and annotation text only — no verdict/creator-rating field by construction)
  - Add the new method signatures to the `Repository` interface with their idempotency/scoping/order/authorization contracts documented in comments: `createWorkspace`, `listWorkspacesForReader`, `getMembership`, `workspaceExists`, `listMembers`, `removeMember`, `createInvite`, `redeemInvite`, `createCollection`, `listCollections`, `deleteCollection`, `addCollectionItem`, `removeCollectionItem`, `listCollectionItems`, `createAnnotation`, `listAnnotations`, `getAnnotation`, `updateAnnotation`, `deleteAnnotation`
  - Leave all existing port members unchanged
  - _Requirements: 9.1, 9.2, 10.4, 10.5_

- [x] 2. Implement Workspace persistence in the in-memory Repository
  - [x] 2.1 Implement the new methods in `app/apps/server/src/infra/memory.ts`
    - Add the mirror state: `workspaces`, `membersByWorkspace` (Map workspaceId → Map readerId → {role, joinedAt}), `invites` (code → workspaceId), `collections`, `itemsByCollection` (Map collectionId → Map reportId → addedAt), `annotations` (id → Annotation)
    - `createWorkspace`: generate a UUID, store the workspace, and seed the owner's `{ role: 'owner' }` Membership atomically; return `{ id, name, role: 'owner' }`. `redeemInvite`: resolve code → workspaceId (undefined when no match), insert a `member` Membership only if absent, return the existing role unchanged on repeat. `addCollectionItem`/`removeCollectionItem`/`listCollectionItems`: keep original `addedAt` on repeat add, no-op on absent remove, sort `addedAt` DESC then `reportId` DESC. `deleteCollection`: drop the collection and its items together. Annotation methods: store/read/update/delete by id; `listAnnotations` filters by workspaceId+reportId, sorts `createdAt` DESC then `id` DESC. Keep each method synchronous between read and write (atomic on the event loop), mirroring the existing review/saved-report methods
    - _Requirements: 1.1, 2.1, 2.3, 2.5, 3.1, 3.2, 4.1, 4.2, 4.3, 5.1, 5.2, 5.5, 6.2, 6.4, 6.6, 7.1, 7.2, 9.2, 9.7, 9.8, 9.10_

  - [x] 2.2 Write property test for membership-scoped isolation
    - **Property 3: Membership-scoped isolation**
    - **Validates: Requirements 3.1, 4.1, 4.2, 4.3, 5.2, 9.8**
    - `fast-check`, min 100 runs, against `InMemoryRepository` with generated multi-reader/multi-workspace state; file `app/apps/server/test/workspace.isolation.test.ts` registered in `package.json` `test`

  - [x] 2.3 Write property test for invite redemption binding and idempotency
    - **Property 4: Invite redemption is well-bound and idempotent**
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5**
    - `fast-check`, min 100 runs; file `app/apps/server/test/workspace.invite.test.ts`

  - [x] 2.4 Write property test for member removal revoking access
    - **Property 5: Member removal revokes access and does not interfere**
    - **Validates: Requirements 3.2, 3.5**
    - `fast-check`, min 100 runs asserting only the target Membership is deleted, the workspace leaves the reader's list, and `getMembership` then returns none; file `app/apps/server/test/workspace.removeMember.test.ts`

  - [x] 2.5 Write property test for collection-item idempotency and non-interference
    - **Property 6: Collection-item add/remove is idempotent and non-interfering**
    - **Validates: Requirements 6.1, 6.2, 6.5, 6.6, 9.7**
    - `fast-check`, min 100 runs over interleaved add/remove sequences; file `app/apps/server/test/workspace.collectionItems.test.ts`

  - [x] 2.6 Write property test for deterministic, stable collection-item ordering
    - **Property 7: Collection-item ordering is deterministic and stable**
    - **Validates: Requirements 6.4**
    - `fast-check`, min 100 runs asserting `addedAt` DESC then `reportId` DESC and identical order across repeated calls; file `app/apps/server/test/workspace.order.test.ts`

  - [x] 2.7 Write property test for annotation recording, scope, and order
    - **Property 8: Annotations are recorded, workspace-scoped, and ordered**
    - **Validates: Requirements 7.1, 7.2**
    - `fast-check`, min 100 runs; file `app/apps/server/test/workspace.annotations.test.ts`

  - [x] 2.8 Write property test for owner seeding and owner-Membership retention
    - **Property 9: Workspace creation seeds the owner and the owner Membership always persists**
    - **Validates: Requirements 1.1, 3.4**
    - `fast-check`, min 100 runs asserting creation yields exactly the owner Membership and no member-management sequence removes it; file `app/apps/server/test/workspace.ownerSeed.test.ts`

  - [x] 2.9 Write property test for lens-not-judge data shapes
    - **Property 10: Workspace responses and the annotation model are lens-not-judge**
    - **Validates: Requirements 10.4, 10.5**
    - `fast-check`, min 100 runs asserting every projection's key set carries no content-truthfulness verdict, no creator-reliability rating, and no creator-attached tier; file `app/apps/server/test/workspace.neutrality.test.ts`

  - [x] 2.10 Write property test for report-content immutability across workspace operations
    - **Property 11: Report content is immutable across workspace operations**
    - **Validates: Requirements 11.3**
    - `fast-check`, min 100 runs snapshotting report content before/after add/remove/read/annotate/list; file `app/apps/server/test/workspace.reportImmutable.test.ts`

- [x] 3. Checkpoint - Ensure all in-memory tests pass
  - Run `npm test` and `npm run typecheck` in `app/apps/server`. Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add the additive migration and Postgres implementation
  - [x] 4.1 Create migration `007_workspaces.sql`
    - Add `db/migrations/007_workspaces.sql` creating the six tables — `workspaces`, `workspace_members` (PK `(workspace_id, reader_id)`, `role CHECK IN ('owner','member')`), `workspace_invites`, `shared_collections`, `collection_items` (PK `(collection_id, report_id)`), `annotations` — with `reader_id`/`owner_id`/`author_id` as `TEXT` (Supabase JWT subject, following `006`), `ON DELETE CASCADE` on every parent→child FK, `report_id` FKs to `analysis_reports(id) ON DELETE CASCADE`, and the listing indexes (`idx_workspace_members_reader`, `idx_shared_collections_workspace`, `idx_collection_items_listing`, `idx_annotations_listing`); all with `IF NOT EXISTS`; additive only, applies lexically after `006_saved_reports.sql`
    - _Requirements: 9.3, 9.4, 9.5, 6.2, 6.4, 7.2, 9.7_

  - [x] 4.2 Implement the new methods in `app/apps/server/src/infra/postgres.ts`
    - Parameterized SQL only, no string interpolation. `createWorkspace` and `deleteCollection` run inside a `BEGIN … COMMIT` transaction so a workspace never exists without its owner Membership and a deleted collection never orphans items. `redeemInvite` uses `INSERT ... ON CONFLICT (workspace_id, reader_id) DO NOTHING` then reads back the role; `addCollectionItem` uses `INSERT ... ON CONFLICT (collection_id, report_id) DO NOTHING`; list queries use the deterministic `ORDER BY` clauses from the design. Map rows to the port projections; let backing-store failures reject the promise (route → 5xx, existing data unchanged, no partial mutation)
    - _Requirements: 9.1, 9.2, 9.6, 9.9, 5.5_

  - [x] 4.3 Write parity integration test for both repositories
    - **Property 12: In-memory and Postgres repositories agree**
    - **Validates: Requirements 9.2**
    - `fast-check`, min 100 runs, same generated op-sequence against `InMemoryRepository` (model) and `PostgresRepository`; registered under `test:integration` (needs a live DB)

  - [x] 4.4 Write migration integration test
    - Apply `007` to a populated database; assert all pre-existing rows preserved, the six new tables and four indexes present, existing route response shapes unchanged, and lexical apply order after `006_saved_reports.sql`
    - _Requirements: 9.3, 9.4_
    - Registered under `test:integration`

- [x] 5. Add validation, the membership guard, and the gated routes
  - [x] 5.1 Add the zod schemas in `app/apps/server/src/http/validation.ts`
    - Export `workspaceNameSchema` / `collectionNameSchema` (`name` trimmed 1–100), `collectionItemSchema` (`reportId` uuid), `annotationTextSchema` (`text` 1–4000), `inviteCodeParam` (1–200); reuse the existing UUID `reportIdParam` for `:cid`/`:aid`/`:reportId` path params
    - _Requirements: 8.4, 1.4, 5.4, 7.6_

  - [x] 5.2 Add the `loadMembership` guard and all workspace routes in `app/apps/server/src/http/routes.ts`
    - Implement `loadMembership(repo, workspaceId, readerId)`: `workspaceExists` false → 404 (before the membership check), `getMembership` undefined → 403, else return the role; owner-only ops additionally require `role === 'owner'` → 403; annotation edit/delete uses the author-or-owner predicate from `repo.getAnnotation` (mismatched/absent workspace → 404). Add every route behind `requireAuth` with `req.user!.id` as the reader: `POST/GET /workspaces`, `POST /workspaces/:id/invites`, `POST /invites/:code/redeem`, `GET /workspaces/:id/members`, `DELETE /workspaces/:id/members/:readerId` (400 on owner self-removal before any delete), `POST/GET /workspaces/:id/collections`, `DELETE /workspaces/:id/collections/:cid`, `POST/GET/DELETE collection items`, `POST/GET annotations`, `PATCH/DELETE /workspaces/:id/annotations/:aid`. Report existence for collection-add and annotation-create uses `repo.getReport` → 404. Telemetry (where emitted) carries workspace/report id only — never the reader id
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.3, 4.4, 5.1, 5.2, 5.3, 5.5, 5.6, 6.1, 6.3, 6.5, 6.7, 7.1, 7.3, 7.4, 7.5, 7.7, 7.8, 8.1, 8.2, 8.3, 8.5, 8.6, 8.7, 9.1, 10.5_

  - [x] 5.3 Write property test for membership-and-role authorization
    - **Property 1: Authorization follows membership and role**
    - **Validates: Requirements 2.2, 3.3, 5.3, 5.6, 6.7, 7.8, 8.2, 8.3, 8.5**
    - `fast-check`, min 100 runs driving the `loadMembership` decision through generated membership/role states; file `app/apps/server/test/workspace.authz.test.ts` registered in `package.json` `test`

  - [x] 5.4 Write property test for annotation edit/delete authorization
    - **Property 2: Annotation edit/delete authorization is author-or-owner**
    - **Validates: Requirements 7.3, 7.4, 7.5**
    - `fast-check`, min 100 runs asserting edit/delete authorized iff author or owner, else the annotation is unchanged; file `app/apps/server/test/workspace.annotationAuthz.test.ts`

  - [x] 5.5 Write route integration tests for gating, error paths, and success shapes
    - 401 without token across the route set; 401 when auth unconfigured; 404 on unknown workspace; 403 for non-member and for member-attempting-owner-op; 400 on malformed body/params; 404 on redeem-unknown-code and add/annotate-missing-report; 400 on owner self-removal; 201/200 success shapes; injected failing pool → 5xx with no partial mutation
    - _Requirements: 1.2, 2.2, 2.4, 3.4, 5.4, 5.6, 6.3, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 9.9_
    - Registered under `test:integration`

- [x] 6. Checkpoint - Ensure all server tests pass
  - Run `npm test` and `npm run typecheck` in `app/apps/server`. Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add the web session-aware API layer
  - [x] 7.1 Add the workspace calls and mirrored types in `app/apps/web/src/api/client.ts`
    - Route every new call through the existing `authedFetch(path, init, accessToken)` so `Authorization: Bearer` is attached iff a session is active, map `401 → AuthExpiredError` (existing teardown), and surface `403` as a typed `WorkspaceForbiddenError`: `createWorkspace`, `listWorkspaces`, `createInvite`, `redeemInvite`, `listMembers`, `removeMember`, `createCollection`, `listCollections`, `deleteCollection`, `addCollectionItem`, `listCollectionItems`, `removeCollectionItem`, `createAnnotation`, `listAnnotations`, `editAnnotation`, `deleteAnnotation`. Add mirrored `WorkspaceRole`, `WorkspaceSummary`, `Membership`, `SharedCollection`, `CollectionItemEntry`, `Annotation` to `app/apps/web/src/api/types.ts`
    - _Requirements: 13.2, 13.3, 13.5, 13.6_

  - [x] 7.2 Write property test for token attachment
    - **Property 13: Token attachment follows session state**
    - **Validates: Requirements 13.2, 13.3**
    - Vitest + `fast-check`, min 100 runs over the new workspace calls asserting the `Authorization` header is present iff a session token is supplied; file `app/apps/web/src/api/workspaceAuthedFetch.test.ts`

- [x] 8. Add the Workspace_View surfaces
  - [x] 8.1 Create the workspace list view (`#/workspaces`) in `app/apps/web/src/components/`
    - List the reader's workspaces (each with name + role) with a create-workspace form and a redeem-invite form; on create-confirmation present the new workspace as selected with the reader listed as owner; empty-state message + create control when zero memberships; when not Auth_Configured render the workspace-features-unavailable message and no create/redeem forms. Render names/roles only — no verdict, no creator rating; accent `#0d9488`, icons from `lucide-react`, single column 200–768px, accessible name+role on every control, visible focus, ARIA live status region, color-never-alone labels
    - _Requirements: 1.5, 4.5, 10.1, 10.2, 10.3, 12.1, 12.3, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [x] 8.2 Create the workspace detail view (`#/workspaces/:id`) in `app/apps/web/src/components/`
    - Render members (subject + role), collections (create/list/delete), collection items (add/list/remove, newest-first), and annotations (create/list newest-first, author-attributed note, edit/delete for author-or-owner); render report references and annotation text only — no verdict, no creator rating, any source tier stays on a source/citation; a `403` shows the access-denied message and no workspace data. Same accent/icon/single-column/ARIA/keyboard/focus conventions
    - _Requirements: 6.4, 7.2, 10.1, 10.2, 10.3, 10.6, 13.6, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [x] 8.3 Write component tests for the Workspace_View surfaces
    - Create workspace → selected/owner-listed transition (Req 1.5); empty-state + create offer at zero memberships (Req 4.5); collections/items/annotations render and update with newest-first order; neutrality (no truthfulness verdict, no creator rating, tier stays on source/citation, annotation as attributed note); accessibility via vitest-axe (accessible name+role, keyboard reachability/activation, visible focus), single column 200–768px, color-never-alone labels, ARIA live region
    - _Requirements: 1.5, 4.5, 6.4, 7.2, 10.1, 10.2, 10.3, 10.6, 14.1, 14.2, 14.3, 14.4, 14.7, 14.8_

- [x] 9. Wire workspace routing and session handling
  - [x] 9.1 Add the workspace hash routes and session wiring in `app/apps/web/src/App.tsx`
    - Extend the existing hash router (no third-party router dependency) with `#/workspaces` and `#/workspaces/:id`; when anonymous + Auth_Configured opening a Workspace_View routes to sign-in and retains the target view for post-sign-in return; a workspace `401` ends the Session and presents the Anonymous experience; a `403` shows the access-denied message; keep the home/loading/report/shared-report/methodology/history views working and boot raising no unhandled error when not Auth_Configured
    - _Requirements: 12.2, 12.4, 12.5, 13.1, 13.4, 13.5, 13.6_

  - [x] 9.2 Write component tests for routing and session/degraded behavior
    - Anonymous + configured opens a Workspace_View → sign-in with retained target (Req 13.4); 401 → anonymous (Req 13.5); 403 → access message, no data (Req 13.6); not Auth_Configured → unavailable message, no create/redeem forms, control activation sends nothing and leaves the view unchanged, other views keep working, boot raises no unhandled error (Req 12.1–12.5)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 13.4, 13.5, 13.6_

- [x] 10. Add smoke / static guard tests
  - [x] 10.1 Write static architectural guard tests (server)
    - `assemble.ts` byte-for-byte unchanged (file hash) and no pipeline stage added/removed/reordered/modified; route handlers contain no direct DB queries; Postgres workspace methods use parameterized SQL only in every environment (grep); migration `007` keys reader/author columns as `TEXT` following `006` (grep)
    - _Requirements: 9.1, 9.5, 9.6, 11.1, 11.2, 11.4_

  - [x] 10.2 Write static guard tests (web)
    - No third-party router dependency in `apps/web/package.json`; workspace routes are hash-based `#/workspaces` / `#/workspaces/:id`; accent `#0d9488` and `lucide-react` icon sourcing on the new surfaces
    - _Requirements: 13.1, 14.5, 14.6_

  - [x] 10.3 Write the offline-first wiring test (server)
    - With the in-memory repository and no API keys, every workspace/collection/annotation/membership operation completes without error and returns the resulting state
    - _Requirements: 9.10_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Run server `npm test` + `npm run typecheck` (in `app/apps/server`) and web `npx vitest run` + `tsc -b` (in `app/apps/web`); run `npm run test:integration` when a database is available. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirements (sub-requirement clauses, not just user stories) for traceability.
- Property tests implement the design's thirteen Correctness Properties (each property is a single property-based test): Properties 3–11 against the in-memory repository (Task 2), Properties 1–2 against the `loadMembership`/author-or-owner guard (Task 5), Property 12 (parity) and Property 13 (token attachment) in Tasks 4 and 7.
- Example/integration/smoke tests cover HTTP gating, error paths, UI transitions, the migration, and the static architectural rules.
- Integration and parity tests (4.3, 4.4, 5.5) need a live database and run under `test:integration`.
- The Invariant_Gate (`core/assemble.ts`) is read-only and verified, never edited (Req 11).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "4.1", "5.1", "7.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "4.2", "7.2"] },
    { "id": 3, "tasks": ["4.3", "4.4", "5.2"] },
    { "id": 4, "tasks": ["5.3", "5.4", "5.5"] },
    { "id": 5, "tasks": ["8.1", "8.2"] },
    { "id": 6, "tasks": ["8.3", "9.1"] },
    { "id": 7, "tasks": ["9.2", "10.1", "10.2", "10.3"] }
  ]
}
```
