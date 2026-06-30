# Implementation Plan: Supabase User Sync

## Overview

This plan closes the one legacy FK seam (`flags.user_id → users(id)`) by introducing **User_Sync** — an idempotent, claims-only upsert behind the `Repository` seam — and invoking it at the flag trust boundary before the FK-bearing insert. Work is foundation-first: the additive migration, the `ports.ts` interface, and both Repository drivers land first so the offline-first parity path is intact, then the trust-boundary validation and the flag-route wiring consume them.

Implementation language is **TypeScript** (server: Node + Express, `node:test` runner, ESM extensionless relative imports). Property tests use **`fast-check`** with a **minimum of 100 runs** per property, under `node:test` + `node:assert`. Every property test carries the comment `// Feature: supabase-user-sync, Property <n>: <description>` plus a `Validates: Requirements …` reference. New server test files are registered into the explicit `test/*.test.ts` list in `apps/server/package.json` (Postgres-dependent ones go to `test:integration`).

Two rules carry the moat through every task: the change is **additive** (new `Repository` methods, two zod schemas, one route change, one data-preserving migration — `core/assemble.ts` is never touched, and the existing `invariant.diffGuard.test.ts` guard enforces that), and **lens-not-judge** holds by construction (the `LocalUser` shape carries only identity-derived fields — `id`, `email`, `role`, `createdAt` — no verdict, no creator rating).

## Tasks

- [x] 1. Repository seam — interface, both drivers, additive migration
  - [x] 1.1 Add the `LocalUser` type and User_Sync method signatures to `infra/ports.ts`
    - Add `LocalUser` interface (`id`, `email: string | null`, `role`, `createdAt`) carrying identity-derived fields only — no verdict or creator-rating field by construction
    - Add `ensureLocalUser(user: { id: string; email?: string; role?: string }): Promise<void>` and `getLocalUser(id: string): Promise<LocalUser | undefined>` to the `Repository` interface; inline claim shape, no `AuthUser` import (keep `ports.ts` free of auth-layer coupling)
    - _Requirements: 1.1, 7.1, 10.2_

  - [x] 1.2 Implement User_Sync on `InMemoryRepository` (`infra/memory.ts`)
    - Back with a private `Map<string, LocalUser>` keyed by subject; create on first sync (email absent ⇒ `null` per Req 5.1; role absent ⇒ `'user'`); on repeat preserve `id` + `createdAt` and merge only present claims (overwrite when claim present, retain when absent)
    - Atomic by construction (no `await` between read and write on the single-threaded loop); distinct email-absent subjects never collide (keyed by `id` only); `getLocalUser` returns a defensive copy
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 5.1, 5.2_

  - [x] 1.3 Implement User_Sync on `PostgresRepository` (`infra/postgres.ts`)
    - Single parameterized `INSERT … ON CONFLICT (id) DO UPDATE` — `created_at` never in the `SET` list (preserved on repeat); `COALESCE` retains stored `email`/`role` when the claim is absent and updates when present; parameterized SQL only, no string interpolation
    - `getLocalUser` SELECTs `id, email, role, created_at` for the subject, normalizing `created_at` to ISO 8601; a failed insert rejects with no partial row (single statement commits or does not)
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 6.3, 8.1_

  - [x] 1.4 Add migration `009_user_sync.sql`
    - Create `app/db/migrations/009_user_sync.sql` with `ALTER TABLE users ALTER COLUMN email DROP NOT NULL` so an email-absent synced user is storable with `email` NULL; leave `UNIQUE(email)` intact (NULLs distinct under the index)
    - Data-preserving and re-runnable (`DROP NOT NULL` is idempotent); three-digit `009_` prefix sorts lexically after `008_`
    - _Requirements: 5.1, 9.1, 9.2, 9.3, 9.4_

  - [x] 1.5 Write property test for idempotent identity
    - **Property 1: Idempotent identity**
    - For any subject and any sequence of ≥1 `ensureLocalUser` calls, exactly one Local_User exists, its `id` equals the subject, and its `created_at` equals the first call's value; run against the in-memory driver
    - New file `test/userSync.idempotent.prop.test.ts`
    - **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 2.3**

  - [x] 1.6 Write property test for claim reflection with retain
    - **Property 2: Claim reflection with retain**
    - For any sequence of calls for a single subject, stored `email`/`role` each equal the most recent call that provided the field and are retained across later omitting calls; generator includes present/absent role and email
    - New file `test/userSync.claimMerge.prop.test.ts`
    - **Validates: Requirements 1.4, 1.5, 2.4, 2.5**

  - [x] 1.7 Write property test for concurrent convergence
    - **Property 3: Concurrent convergence**
    - For any subject, N concurrent `ensureLocalUser` calls settle to exactly one Local_User; in-memory leg here, Postgres leg added in the parity/integration task
    - New file `test/userSync.concurrent.prop.test.ts`
    - **Validates: Requirements 2.6**

  - [x] 1.8 Write property test for email-absent validity and non-collision
    - **Property 4: Email-absent validity and non-collision**
    - For any set of distinct subjects all omitting email, each becomes its own Local_User with `email` null, persisted without error or uniqueness conflict
    - New file `test/userSync.emailAbsent.prop.test.ts`
    - **Validates: Requirements 5.1, 5.2**

  - [x] 1.9 Write static guard tests for repository presence, SQL safety, and neutrality
    - Both drivers implement `ensureLocalUser`/`getLocalUser` (type-level + presence assertion); the Postgres User_Sync SQL uses bound parameters only and no User_Sync query exists outside `memory.ts`/`postgres.ts`; `LocalUser` exposes only `id`/`email`/`role`/`createdAt` with no verdict or creator-rating field
    - New file `test/userSync.guardsStatic.test.ts`
    - _Requirements: 7.5, 8.1, 10.2_

- [x] 2. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Trust-boundary validation and flag-route wiring
  - [x] 3.1 Add `syncedIdentitySchema` to `http/validation.ts`
    - zod object: `id` non-empty UUID (required), `email` valid address ≤320 chars (optional), `role` non-empty ≤255 chars (optional); export the inferred `SyncedIdentity` type
    - _Requirements: 8.2, 8.4_

  - [x] 3.2 Wire User_Sync into the flag route handler (`http/routes.ts`)
    - After the technique-surfaced check and before `createFlag`: parse `{ id, email, role }` from `req.user` with `syncedIdentitySchema` (failure ⇒ 400 `invalid_identity`, no sync, no persist); call `ensureLocalUser` in a try/catch (failure ⇒ 500 `sync_failed`, generic body, `telemetry.capture` with report id + stage only, no flag persisted); pass `userId: identity.data.id` to `createFlag`; preserve the existing 201 success body and flag idempotency
    - Dispute and saved-report/workspace routes remain untouched (never call `ensureLocalUser`)
    - _Requirements: 1.1, 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3, 8.3, 8.5_

  - [x] 3.3 Write property test for flag resolving to the synced user
    - **Property 5: Flag resolves to the synced user**
    - For any valid flag (with/without email claim, technique the report surfaced), the persisted flag's `user_id` equals the subject and resolves to the Local_User keyed to it, returning the existing flag success result; route harness over the in-memory Repository
    - New file `test/userSync.flagResolves.prop.test.ts`
    - **Validates: Requirements 1.2, 3.1, 3.2, 5.3**

  - [x] 3.4 Write property test for preserved flag idempotency
    - **Property 6: Flag idempotency preserved**
    - For any valid flag submitted ≥2 times, exactly one flag is persisted and every submission returns the existing success result
    - New file `test/userSync.flagIdempotent.prop.test.ts`
    - **Validates: Requirements 3.3**

  - [x] 3.5 Write property test for malformed identity/claims rejection
    - **Property 7: Malformed identity or claims rejected with no side effect**
    - For any flag request whose subject is absent/non-UUID, or whose present email/role violates the bounds, the system returns a client error and persists neither a Local_User nor a flag
    - New file `test/userSync.validation.prop.test.ts`
    - **Validates: Requirements 3.4, 8.2, 8.3, 8.4, 8.5**

  - [x] 3.6 Write property test for sync-failure isolation
    - **Property 8: Sync-failure isolation**
    - For any otherwise-valid flag, when `ensureLocalUser` fails (failing-repo stub), the system returns a server error, persists neither a Local_User nor the flag, and leaves prior data unchanged
    - New file `test/userSync.failureIsolation.prop.test.ts`
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [x] 3.7 Write property test for readiness invariance
    - **Property 10: Readiness invariance**
    - For any report inputs, the readiness classification from the invariant gate is identical whether or not a User_Sync has run (User_Sync reads/writes no gate input)
    - New file `test/userSync.gatePreserve.prop.test.ts`
    - **Validates: Requirements 10.3, 10.4**

  - [x] 3.8 Write example tests for offline wiring and scope isolation
    - Offline: `buildContext()` with zero keys composes the in-memory Repository, starts without error, and a flag submission succeeds end-to-end with no network seam in `ensureLocalUser`
    - Scope isolation: save, workspace-create, and dispute-intake create no `users` row for the subject (`getLocalUser` undefined) and invoke no sync; the dispute persists with `raised_by` NULL
    - New file `test/userSync.scopeOffline.test.ts`
    - _Requirements: 1.3, 4.1, 4.2, 4.3, 4.4, 4.5, 7.3, 7.4_

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Driver parity, migration integration, and test registration
  - [x] 5.1 Write property test for driver parity
    - **Property 9: Driver parity**
    - For any identical sequence of `ensureLocalUser` inputs applied to the in-memory and Postgres Repositories, both yield equivalent Local_User state (one row per subject, matching `email`/`role`, `created_at` preserved across repeats); includes the Postgres concurrent-convergence leg for Property 3
    - New file `test/userSync.parity.prop.test.ts` (runs under `test:integration` against a real `DATABASE_URL`)
    - **Validates: Requirements 7.2**

  - [x] 5.2 Write migration integration test
    - Apply `009` to a populated DB twice — assert no error, `users.email` nullable after, and every seeded row unchanged — plus a filename-ordering smoke assertion (`009_…` sorts after `008_…`)
    - New file `test/userSync.migration.test.ts` (runs under `test:integration`)
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 5.3 Register new server test files in `apps/server/package.json`
    - Add the created `test/userSync.*.test.ts` files to the explicit `test` script list; route the Postgres-dependent parity and migration tests to `test:integration`
    - _Requirements: (build/test wiring)_

- [x] 6. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise. Run `npm test` and `npm run typecheck` in `apps/server`; run the Postgres-dependent parity and migration tests via `npm run test:integration` against a configured `DATABASE_URL`.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks (1.1–1.4, 3.1, 3.2, 5.3) are never optional.
- Each task references specific requirement clauses for traceability; property test sub-tasks each reference a numbered property from the design's Correctness Properties section.
- Property-based tests use `fast-check` (min 100 runs), carry the required `// Feature: supabase-user-sync, Property <n>: …` comment plus a `Validates: Requirements …` reference, and their generators include the email-absent case, present/absent role, and repeated/interleaved sync sequences.
- The migration shape, offline wiring, scope-boundary non-interference, SQL safety, neutrality, and the untouched invariant gate are covered by integration/example/static tests, not property tests (per the design Testing Strategy). The existing `invariant.diffGuard.test.ts` already fails the build if `core/assemble.ts` changes — this feature relies on it and edits neither `assemble.ts` nor `pipeline/stages.ts`.
- The change is strictly additive and confined to three layers behind existing seams (trust boundary, persistence seam, schema); checkpoints provide incremental validation at each boundary.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4", "3.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.5", "1.6", "1.7", "1.8", "1.9", "3.2", "5.1", "5.2"] },
    { "id": 3, "tasks": ["3.3", "3.4", "3.5", "3.6", "3.7", "3.8"] },
    { "id": 4, "tasks": ["5.3"] }
  ]
}
```
