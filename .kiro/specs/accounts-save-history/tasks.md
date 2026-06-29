# Implementation Plan: Accounts Save & History

## Overview

This plan implements Slice 2 ("Pilots") in incremental, integration-first steps: the server persistence layer first (port → in-memory → Postgres → migration), then the gated routes that consume it, then the web auth seam, session-aware API layer, and the sign-in/history surfaces, finishing by wiring the existing Flag/Save controls to a real session. Each step builds on the previous one and ends wired into the app — no orphaned code. Property tests track the design's Correctness Properties; example/integration/smoke tests cover UI transitions, route gating, the migration, and the static architectural rules.

Language: TypeScript (ESM, extensionless relative imports on the server; React 19 + Vite on the web), matching the existing monorepo.

## Tasks

- [x] 1. Add Saved_Report persistence to the Repository port
  - In `app/apps/server/src/infra/ports.ts`, add the `SavedReportEntry` type (`reportId: string`, `savedAt: string` ISO 8601) and the three method signatures `saveSavedReport(readerId, reportId)`, `removeSavedReport(readerId, reportId)`, `listSavedReports(readerId)` to the `Repository` interface, with the idempotency/scoping/order contract documented in comments
  - Leave all existing port members unchanged
  - _Requirements: 11.1, 11.2, 9.2, 9.6, 12.4, 12.5_

- [x] 2. Implement Saved_Report persistence in the in-memory Repository
  - [x] 2.1 Implement the three methods in `app/apps/server/src/infra/memory.ts`
    - Add `savedByReader = new Map<string, Map<string, string>>()`; `saveSavedReport` keeps the existing `savedAt` on repeat (idempotent), else sets `new Date().toISOString()`; `removeSavedReport` deletes if present, no-op otherwise; `listSavedReports` snapshots the reader's entries, sorts `savedAt` DESC then `reportId` DESC, returns `[]` for unknown reader
    - Keep each method synchronous between read and write (atomic on the event loop), mirroring the existing review methods
    - _Requirements: 7.3, 8.3, 9.2, 9.6, 10.7, 10.8, 11.6, 11.7, 11.8, 11.10_

  - [x] 2.2 Write property test for save idempotency + history visibility
    - **Property 1: Save is idempotent and visible in history**
    - **Validates: Requirements 7.3, 9.8, 11.6, 11.7**
    - `fast-check`, min 100 runs, against `InMemoryRepository`; file `app/apps/server/test/savedReports.idempotent.test.ts` registered in `package.json` `test`

  - [x] 2.3 Write property test for remove idempotency + non-interference
    - **Property 2: Remove is idempotent and non-interfering**
    - **Validates: Requirements 8.3, 10.7, 11.10**
    - `fast-check`, min 100 runs; file `app/apps/server/test/savedReports.remove.test.ts`

  - [x] 2.4 Write property test for reader-scoped history
    - **Property 3: History is reader-scoped**
    - **Validates: Requirements 9.6, 10.5, 10.8, 11.8**
    - `fast-check`, min 100 runs; file `app/apps/server/test/savedReports.scoped.test.ts`

  - [x] 2.5 Write property test for deterministic, stable history ordering
    - **Property 4: History ordering is deterministic and stable**
    - **Validates: Requirements 9.2**
    - `fast-check`, min 100 runs; file `app/apps/server/test/savedReports.order.test.ts`

  - [x] 2.6 Write property test for saved-report content immutability
    - **Property 6: Saved report content is immutable across save/history operations**
    - **Validates: Requirements 13.3**
    - `fast-check`, min 100 runs; assert report content unchanged across save/remove/list; file `app/apps/server/test/savedReports.immutable.test.ts`

- [x] 3. Checkpoint - Ensure all in-memory tests pass
  - Run `npm test` and `npm run typecheck` in `app/apps/server`. Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add the additive migration and Postgres implementation
  - [x] 4.1 Create migration `006_saved_reports.sql`
    - Add `db/migrations/006_saved_reports.sql` creating `reader_saved_reports (reader_id TEXT, report_id UUID REFERENCES analysis_reports(id) ON DELETE CASCADE, saved_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (reader_id, report_id))` and index `idx_reader_saved_reports_listing (reader_id, saved_at DESC, report_id DESC)`, all with `IF NOT EXISTS`; additive only, applies lexically after `005_review_workflow.sql`
    - _Requirements: 11.3, 11.4, 7.3, 11.6, 9.2_

  - [x] 4.2 Implement the three methods in `app/apps/server/src/infra/postgres.ts`
    - Parameterized SQL only: `INSERT ... ON CONFLICT (reader_id, report_id) DO NOTHING` for save; `DELETE ... WHERE reader_id=$1 AND report_id=$2` for remove; `SELECT report_id, saved_at ... WHERE reader_id=$1 ORDER BY saved_at DESC, report_id DESC` for list; map rows to `SavedReportEntry`; let backing-store failures reject (route → 5xx, no partial mutation)
    - _Requirements: 11.1, 11.2, 11.5, 11.9, 9.2, 9.6_

  - [x] 4.3 Write parity integration test for both repositories
    - **Property 5: In-memory and Postgres repositories agree**
    - **Validates: Requirements 11.2**
    - `fast-check`, min 100 runs, same generated op-sequence against `InMemoryRepository` (model) and `PostgresRepository`; registered under `test:integration` (live DB)

  - [x] 4.4 Write migration integration test
    - Apply `006` to a populated database; assert all pre-existing rows preserved, `reader_saved_reports` present, existing route response shapes unchanged, lexical apply order after `005`
    - _Requirements: 11.3, 11.4_
    - Registered under `test:integration`

- [x] 5. Add validation and the three gated routes
  - [x] 5.1 Add the `:id` UUID validator in `app/apps/server/src/http/validation.ts`
    - Export `reportIdParam = z.string().uuid()` for the save/remove path parameter (history takes no input)
    - _Requirements: 10.4_

  - [x] 5.2 Add `POST/DELETE /api/v1/analyses/:id/save` and `GET /api/v1/saved-reports` in `app/apps/server/src/http/routes.ts`
    - All three behind `requireAuth`; reader is `req.user!.id`. Save: validate id (400), load `repo.getReport(id)` → 404 if missing, then `repo.saveSavedReport` → `200 { ok: true, saved: true }`. Remove: validate id (400), `repo.removeSavedReport` → `200 { ok: true, saved: false }` (success even when not saved, no 404). History: `repo.listSavedReports` → `200 SavedReportEntry[]` (`[]` when empty). Emit telemetry `save`/`unsave` with `{ reportId }` only (never reader id)
    - _Requirements: 7.1, 7.4, 7.5, 8.1, 8.3, 9.1, 9.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 12.4, 12.5_

  - [x] 5.3 Write property test for lens-not-judge API responses
    - **Property 7: Account-surface responses are lens-not-judge**
    - **Validates: Requirements 12.4, 12.5, 12.6**
    - `fast-check`, min 100 runs over generated saved states asserting the response key set carries no verdict/creator-rating/creator-attached-tier; file `app/apps/server/test/savedReports.neutrality.test.ts`

  - [x] 5.4 Write route integration tests for auth gating and scoping
    - 401 without token, 400 on malformed id, 404 on save to missing report, 200 success scoped to the verified reader, empty-collection history
    - _Requirements: 7.4, 7.5, 8.4, 9.7, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.8_
    - Registered under `test:integration`

- [x] 6. Checkpoint - Ensure all server tests pass
  - Run `npm test` and `npm run typecheck` in `app/apps/server`. Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add the web AuthClient seam
  - [x] 7.1 Create `app/apps/web/src/auth/authClient.ts`
    - Define `Session` and `AuthClient` interfaces; implement `isAuthConfigured(env)` (both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` present, URL parseable as `http(s):`); `makeAuthClient(env)` returns `UnavailableAuthClient` (`configured=false`, calls reject `auth_unavailable`, never constructs the SDK) when not configured, else `SupabaseAuthClient` wrapping `@supabase/supabase-js` with `persistSession`/`autoRefreshToken`; enforce 30s timeouts on `signUp`/`signIn` via `AbortController`/race; add the credential validator (non-empty email ≤254 chars, syntactically valid; password 8–72 chars)
    - Add `@supabase/supabase-js` to `app/apps/web/package.json`
    - _Requirements: 1.1, 1.8, 2.1, 2.7, 3.1, 3.2, 4.1, 4.5, 4.6, 4.7, 5.4, 5.5, 1.5, 1.6, 1.7, 2.6_

  - [x] 7.2 Write property test for credential validation
    - **Property 8: Credential validation accepts exactly the well-formed inputs**
    - **Validates: Requirements 1.5, 1.6, 1.7, 2.6**
    - Vitest + `fast-check`, min 100 runs; file `app/apps/web/src/auth/credentialValidator.test.ts`

  - [x] 7.3 Write property test for auth-configuration detection
    - **Property 9: Auth configuration detection is total**
    - **Validates: Requirements 5.5**
    - Vitest + `fast-check`, min 100 runs over generated config objects; file `app/apps/web/src/auth/isAuthConfigured.test.ts`

- [x] 8. Add the session-aware API layer
  - [x] 8.1 Add `authedFetch` and save/history calls in `app/apps/web/src/api/client.ts`
    - `authedFetch(path, init, accessToken?)` attaches `Authorization: Bearer` only when a token is present, omits it otherwise; maps `401 → AuthExpiredError`. Add `saveReport`, `unsaveReport`, `listSavedReports`; extend `submitFlag` to take a token; add mirrored `SavedReportEntry` to `app/apps/web/src/api/types.ts`
    - _Requirements: 3.4, 4.2, 4.3, 4.4, 6.3, 6.4, 7.1, 8.1, 9.1_

  - [x] 8.2 Write property test for token attachment
    - **Property 10: Token attachment follows session state**
    - **Validates: Requirements 3.4, 4.2, 4.3**
    - Vitest + `fast-check`, min 100 runs asserting header presence iff a session token is supplied; file `app/apps/web/src/api/authedFetch.test.ts`

- [x] 9. Add session state and the auth surface
  - [x] 9.1 Create the `useSession` hook in `app/apps/web/src/auth/useSession.ts`
    - Own live `Session | null`, subscribe to `authClient.onChange`, expose `signIn/signUp/signOut`; clear session on `AuthExpiredError` (401); hold a pending-gated-action ref `{ reportId, control }` for post-sign-in return
    - _Requirements: 2.2, 3.3, 4.1, 4.4, 4.5, 4.6, 4.7, 6.2, 6.7_

  - [x] 9.2 Create `AuthPanel.tsx` in `app/apps/web/src/components/`
    - Sign-up and sign-in forms with client-side validation, in-flight submit disabling, error/timeout messaging via an ARIA live region, keyboard operability and visible focus; when not Auth_Configured render the unavailable message and no form; retain submitted email on sign-in failure
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 5.1, 14.2, 14.4, 14.8, 14.9_

  - [x] 9.3 Write component tests for the auth surface
    - Sign-up/sign-in/sign-out success, rejection, in-flight disable, timeout, re-enable, and session restore with an injected fake `AuthClient` + fake timers; not-configured renders message and no form; axe accessible name/role checks
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 3.1, 3.2, 3.3, 3.5, 4.1, 5.1, 14.2, 14.4, 14.8, 14.9_

- [x] 10. Add the History_View
  - [x] 10.1 Create `HistoryView.tsx` in `app/apps/web/src/components/`
    - List `SavedReportEntry[]` newest-first; empty-state when zero and hidden otherwise; per-row remove with optimistic exclusion on success and retain-and-error on failure; select-to-open the full report; error+retry on load failure/timeout; render no verdict and no creator rating; accent `#0d9488`, icons from `lucide-react`, single column ≤768px, ARIA live status region
    - _Requirements: 8.1, 8.2, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.9, 12.1, 12.2, 12.3, 14.3, 14.5, 14.6, 14.7, 14.9_

  - [x] 10.2 Write component tests for the History_View
    - Empty-state, populated list ordering, remove success/failure, select-to-open, load error/retry, color-never-alone saved/remove labels, ≤768px single column, ARIA live region
    - _Requirements: 8.1, 8.2, 8.5, 9.1, 9.3, 9.4, 9.5, 9.9, 12.1, 12.2, 14.3, 14.5, 14.9_

- [x] 11. Wire routing and the gated Flag/Save controls
  - [x] 11.1 Add `#/sign-in` and `#/history` routes and a header sign-in/sign-out affordance in `app/apps/web/src/App.tsx`
    - Extend the existing hash router (no third-party router dependency); show Authenticated vs Anonymous experience based on `useSession`; on 401 fall back to Anonymous
    - _Requirements: 2.2, 3.3, 3.4, 4.1, 4.4, 14.1_

  - [x] 11.2 Convert the Save control and gated Flag wiring in `app/apps/web/src/components/Report.tsx`
    - Save control: enabled when session active; sign-in redirect retaining report context + pending control when anonymous + configured; unavailable message and no request when not configured. Flag/Save attach the token on send, disable the activated control while in flight, show "action not recorded"/"save did not complete" on failure and re-enable; show "Saved" text label beside any color/icon; pending-state debounce ignores extra activations; return to the report and re-enable after sign-in completes
    - _Requirements: 5.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.6, 7.7, 14.3_

  - [x] 11.3 Write component tests for gated controls
    - Enabled with session; sign-in redirect when anonymous+configured with retained intent and post-sign-in return; unavailable message when not configured; pending-state debounce; saved indicator with text label; failure re-enable
    - _Requirements: 5.3, 6.1, 6.2, 6.5, 6.6, 6.7, 7.1, 7.2, 7.6, 7.7, 14.3_

- [x] 12. Add smoke / static guard tests
  - [x] 12.1 Write static architectural guard tests (server)
    - `assemble.ts` byte-for-byte unchanged (file hash) and no pipeline stage altered; route handlers contain no direct DB queries; Postgres save/remove/history methods use parameterized SQL only (grep)
    - _Requirements: 11.1, 11.5, 13.1, 13.2, 13.4_

  - [x] 12.2 Write static guard tests (web)
    - No third-party router dependency in `apps/web/package.json`; account/history routes are hash-based; accent `#0d9488` and `lucide-react` icon sourcing on the new surfaces
    - _Requirements: 14.1, 14.6, 14.7_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Run server `npm test` + `npm run typecheck` (in `app/apps/server`) and web `npx vitest run` + `tsc -b` (in `app/apps/web`); run `test:integration` when a database is available. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirements for traceability.
- Property tests (Properties 1–10) validate the design's universal Correctness Properties; example/integration/smoke tests cover UI transitions, route gating, the migration, and the static architectural rules.
- Integration and parity tests (4.3, 4.4, 5.4) need a live database and run under `test:integration`.
- The Invariant_Gate (`core/assemble.ts`) is read-only and verified, never edited (Req 13).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "4.1", "5.1", "7.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "4.2", "7.2", "7.3", "8.1"] },
    { "id": 3, "tasks": ["4.3", "4.4", "5.2", "8.2", "9.1"] },
    { "id": 4, "tasks": ["5.3", "5.4", "9.2", "10.1"] },
    { "id": 5, "tasks": ["9.3", "10.2", "11.1"] },
    { "id": 6, "tasks": ["11.2"] },
    { "id": 7, "tasks": ["11.3", "12.1", "12.2"] }
  ]
}
```
