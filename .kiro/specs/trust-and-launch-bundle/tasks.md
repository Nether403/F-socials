# Implementation Plan: trust-and-launch-bundle

## Overview

This plan converts the design into incremental TypeScript coding steps for the existing
`app/apps/server` (Node + Express + node:test) and `app/apps/web` (React + Vite) packages.
Work is additive: the invariant gate in `core/assemble.ts` is never edited, only verified.

The bundle is built bottom-up: the pure source-tier policy first, then its pipeline/endpoint
wiring, then dispute/flag persistence and routes, then build/deploy hardening, then the web
methodology page, dispute modal, and accessibility pass. Each step builds on the previous and
ends by wiring the new code into a running surface.

Property-based tests use `fast-check` (added as a dev dependency) and each of the 21 design
properties is implemented as a single property test, placed next to the code it validates.

## Tasks

- [x] 1. Source-tier policy module (pure, offline)
  - [x] 1.1 Seed open-signal data
    - Create `app/apps/server/src/core/data/sourceSignals.ts` with plain arrays/sets for the IFCN signatory list, the institutional domain registry (with a curated primary-source subset and suffix rules `.gov`, `.gov.*`, `.mil`, `.edu`, `.ac.*`, `.int`), and the press-council membership list
    - Include NO Ad Fontes / AllSides / MBFC data and NO content-creator dimension
    - _Requirements: 2.2, 2.7_
  - [x] 1.2 Implement the classification policy
    - Create `app/apps/server/src/core/sourceTier.ts` exporting `SOURCE_POLICY_VERSION`, `TIER_RANK`, `classifyCitationTier(sourceUrl)`, and `policyDescriptor()`
    - Parse host, collect matching signals, return the highest-ranked matching tier; `tier3_viewpoint` when none match; `excluded` when the host is unresolvable
    - _Requirements: 2.1, 2.3, 2.4, 2.8, 2.10, 2.11_
  - [x] 1.3 Write property test for tier totality
    - **Property 1: Tier classification is total and single-valued**
    - **Validates: Requirements 2.1**
    - Add `fast-check` dev dependency to `app/apps/server`; run under `node:test`, min 100 runs
  - [x] 1.4 Write property test for signal resolution
    - **Property 2: Tier equals the highest-ranked matching open signal**
    - **Validates: Requirements 2.3, 2.4, 2.8, 2.10, 2.11**
  - [x] 1.5 Write seed-data provenance unit test
    - Assert the signal module references none of Ad Fontes / AllSides / MBFC and exposes no creator dimension
    - _Requirements: 2.2, 2.7_

- [x] 2. Wire the policy into the pipeline and expose it
  - [x] 2.1 Apply tier classification in the pipeline
    - In `app/apps/server/src/pipeline/stages.ts` Stage 3, set `sourceTier: classifyCitationTier(citation.sourceUrl)` on every citation so the policy is authoritative over provider guesses
    - _Requirements: 2.6_
  - [x] 2.2 Single source of truth for the policy version
    - Change the worker `meta.sourcePolicyVersion` to import `SOURCE_POLICY_VERSION` instead of a hardcoded literal
    - _Requirements: 2.5_
  - [x] 2.3 Add the public policy endpoint
    - Add `GET /api/v1/policy` (no auth) in `app/apps/server/src/http/routes.ts` returning `policyDescriptor()`
    - _Requirements: 1.6, 2.5_
  - [x] 2.4 Write property test for served-citation tiers
    - **Property 3: Every served citation carries a policy-assigned tier**
    - **Validates: Requirements 2.6**

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Repository extensions for disputes and flags
  - [x] 4.1 Extend the Repository port
    - Add `createDispute(...)` and `createFlag(...)` to the `Repository` interface in `app/apps/server/src/infra/ports.ts`
    - _Requirements: 3.1, 3.5_
  - [x] 4.2 Implement in-memory repository methods
    - Back `createDispute`/`createFlag` with arrays in `app/apps/server/src/infra/memory.ts` so tests need no database
    - _Requirements: 3.1, 3.2, 3.5_
  - [x] 4.3 Implement Postgres repository methods and migration
    - Implement `createDispute` (`raised_by = NULL`) and `createFlag` (`ON CONFLICT DO NOTHING` on the unique key) in `app/apps/server/src/infra/postgres.ts`
    - Add migration `app/db/migrations/002_*.sql` adding the nullable `claim_id` column to `disputes`
    - _Requirements: 3.1, 3.2, 3.5_

- [x] 5. Dispute and flag intake routes
  - [x] 5.1 Add request validation schemas
    - Add `disputeSchema` (`reason` 1..2000, optional `claimId`) and `flagSchema` (`technique` 1..200, optional `note`) to `app/apps/server/src/http/validation.ts`
    - _Requirements: 3.7_
  - [x] 5.2 Implement the dispute route
    - Add `POST /api/v1/analyses/:id/disputes` (anonymous): 404 if report missing, 400 on invalid body, else 201 and persist a dispute with no user id
    - _Requirements: 3.1, 3.2, 3.6, 3.7_
  - [x] 5.3 Implement the flag route
    - Add `POST /api/v1/analyses/:id/flags` behind `requireAuth`: 401 unauthenticated, 404 if report missing, 400 if `technique` is not in the report's `framingSignals[].technique` set, else 201 and persist a flag bound to report + user
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7_
  - [x] 5.4 Write property test for anonymous dispute persistence
    - **Property 5: A valid anonymous dispute is persisted without a user identity**
    - **Validates: Requirements 3.1, 3.2**
  - [x] 5.5 Write property test for authenticated flag persistence
    - **Property 6: An authenticated flag with a matching technique is persisted to the user**
    - **Validates: Requirements 3.3, 3.5**
  - [x] 5.6 Write property test for unauthenticated flag rejection
    - **Property 7: Unauthenticated flag submissions are rejected and never persisted**
    - **Validates: Requirements 3.4**
  - [x] 5.7 Write property test for nonexistent-report targets
    - **Property 8: Disputes and flags targeting a nonexistent report are not-found and never persisted**
    - **Validates: Requirements 3.6**
  - [x] 5.8 Write property test for invalid bodies
    - **Property 9: Invalid dispute/flag bodies are rejected and never persisted**
    - **Validates: Requirements 3.7**

- [x] 6. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Production build, config validation, CORS, and process split
  - [x] 7.1 Implement the config helper
    - Add a pure `missingRequiredConfig(env, mode)` helper returning the names of required-but-absent deployed-config values (`DATABASE_URL` when `REPO_DRIVER=postgres`, `REDIS_URL` for Redis drivers, `CORS_ORIGIN`)
    - _Requirements: 5.11_
  - [x] 7.2 Make CORS an origin decision
    - Replace the unconditional echo with an `allowOrigin(requestOrigin)` predicate: match `CORS_ORIGIN` → set ACAO and proceed; present but mismatched → 403, no ACAO, resource withheld; absent (same-origin) → proceed
    - _Requirements: 5.7, 5.8_
  - [x] 7.3 Extract the shared composition root
    - Create `app/apps/server/src/compose.ts` exporting `buildContext()` returning `{ repo, cache, queue, limiter, providers, meta }`, moving the driver-selection logic out of `index.ts` verbatim
    - _Requirements: 5.10_
  - [x] 7.4 Split API and worker entrypoints
    - `index.ts` imports `buildContext()` and mounts HTTP only (no `queue.process` in the deployed configuration); add `worker.ts` that imports `buildContext()` and calls `queue.process(...)` only; honor `RUN_WORKER_IN_PROCESS` for local dev
    - _Requirements: 5.10_
  - [x] 7.5 Add the emitting build pipeline
    - In `app/apps/server/package.json` add `build: tsc --noEmit && tsup src/index.ts src/worker.ts`, `start: node dist/index.js`, `start:worker: node dist/worker.js`; add `tsup` as a dev dependency
    - _Requirements: 5.1, 5.2_
  - [x] 7.6 Wire startup validation and degraded access-control warnings
    - At startup, if `missingRequiredConfig` returns names, log each and `process.exit(1)` before `app.listen`; if auth or the rate limiter cannot activate, start anyway and log a warning naming the control (protected routes fail closed)
    - _Requirements: 5.5, 5.6, 5.11, 5.12_
  - [x] 7.7 Write property test for the CORS predicate
    - **Property 15: CORS allows a request if and only if its origin matches the configured origin**
    - **Validates: Requirements 5.7, 5.8**
  - [x] 7.8 Write property test for missing-config reporting
    - **Property 16: Missing required config is reported by name for the deployed configuration**
    - **Validates: Requirements 5.11**
  - [x] 7.9 Write unit test for degraded access controls
    - Starting without `SUPABASE_JWT_SECRET` (and with the limiter unavailable) starts the server and logs a warning naming the control
    - _Requirements: 5.12_
  - [x] 7.10 Write build smoke test
    - `node dist/index.js` and `node dist/worker.js` start without `tsx`; a fixture type error makes `tsc --noEmit` exit non-zero and report it
    - _Requirements: 5.1, 5.2, 5.10_

- [x] 8. Verify the invariant gate is preserved (no source edit)
  - [x] 8.1 Write property test for uncited evidence-asserting claims
    - **Property 17: An uncited claim that asserts evidence holds the report for review**
    - **Validates: Requirements 6.1**
  - [x] 8.2 Write property test for honest "none" claims
    - **Property 18: An honest "none" claim with no citations does not block readiness**
    - **Validates: Requirements 6.2**
  - [x] 8.3 Write property test for framing signals lacking evidence
    - **Property 19: A framing signal lacking evidence holds the report for review**
    - **Validates: Requirements 6.3**
  - [x] 8.4 Write property test for readiness biconditional
    - **Property 20: Readiness is exactly the absence of review reasons**
    - **Validates: Requirements 6.4**
  - [x] 8.5 Write property test for tier-neutral gate outcome
    - **Property 21: Tier classification does not change the gate outcome**
    - **Validates: Requirements 6.1, 6.2, 6.4**

- [x] 9. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Web policy types and Methodology page
  - [x] 10.1 Add policy types and client call
    - Add the `PolicyDescriptor` interface to `app/apps/web/src/api/types.ts` and a `getPolicy()` method to `app/apps/web/src/api/client.ts` (honoring `VITE_API_BASE`)
    - _Requirements: 2.5, 5.9_
  - [x] 10.2 Implement the Methodology page component
    - Create `app/apps/web/src/components/Methodology.tsx` covering: how evidence strength is raised/lowered, the source-tier policy and open signals with the live version, who reviews reports and each review status, how to submit a dispute, the neutrality statement, and glossary terms defined on first use; on `/policy` fetch failure render a "policy version unavailable" note instead of failing
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.10_
  - [x] 10.3 Route to the Methodology page and handle unavailability
    - Add a `{ kind: 'methodology' }` variant to the `App.tsx` `View` union and serve it on `#/methodology` (no auth); if it cannot render, show an unavailable banner and retain the prior report view in state
    - _Requirements: 1.1, 1.11, 1.12_
  - [x] 10.4 Write unit test for methodology rendering
    - Renders without auth and contains every required section, the neutrality statement, glossary definitions, and the mocked `/policy` version
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.10_
  - [x] 10.5 Write unit test for the unavailable path
    - Methodology-unavailable shows the indication and retains report context
    - _Requirements: 1.12_

- [x] 11. Provenance footer and Dispute modal
  - [x] 11.1 Add footer links and dispute control
    - In `app/apps/web/src/components/Report.tsx` add a Methodology link (`#/methodology`) and a "Dispute this analysis" control to the provenance footer
    - _Requirements: 1.7, 3.10_
  - [x] 11.2 Implement the Dispute modal
    - Create the `Dispute_Modal` component: optional pre-filled `claimId`, send `{ claimId, reason }` to the dispute endpoint, show a confirmation on success and an inline error (modal stays open) on failure
    - _Requirements: 3.8, 3.9_
  - [x] 11.3 Add authenticated flag/save controls with auth prompt
    - Add Flag and Save controls; when the current user is unauthenticated, prompt to authenticate before submitting
    - _Requirements: 3.11_
  - [x] 11.4 Write unit tests for footer and modal wiring
    - Methodology link navigates to `#/methodology`; footer dispute control opens the modal; dispute submit sends `{ claimId, reason }` and shows confirmation; unauthenticated flag/save shows the auth prompt
    - _Requirements: 1.11, 3.8, 3.9, 3.10, 3.11_

- [x] 12. Accessibility and UI polish
  - [x] 12.1 Empty and error states
    - Ensure every report section routes empty data to an empty-state message while siblings still render; add a `Retry`/`Back` error view in `App.tsx` that never renders a partial report
    - _Requirements: 4.1, 4.2_
  - [x] 12.2 Standardize the accent color
    - Replace `#00ffe5` with the `#0d9488` success token in `tokens.json` and `styles.css` for evidence-backed/accent signals
    - _Requirements: 4.5_
  - [x] 12.3 Contrast and responsive layout
    - Audit/adjust CSS variables for AA contrast in both themes; collapse to single-column with no horizontal scroll at ≤768px
    - _Requirements: 4.3, 4.4_
  - [x] 12.4 Color-never-alone labels, source chips, ARIA, and above-the-fold
    - Add adjacent text to chart markers and the divergence bar; render each `Source_Chip` as its tier label only (never a creator); add `aria-describedby` to framing highlight tooltips; expose screen-reader text for every issue-frame position; ensure the TLDR and highest-severity framing signal render unexpanded on first paint
    - _Requirements: 2.9, 4.6, 4.8, 4.9, 4.10, 6.5_
  - [x] 12.5 Keyboard operability and focus management
    - Make claim drawers, framing tabs, and the Dispute modal keyboard-operable; move focus in on open, trap focus in the modal, and restore focus to the opener on Escape/dismiss
    - _Requirements: 4.7_
  - [x] 12.6 Write property test for source chips
    - **Property 4: A source chip renders its tier label and never a creator**
    - **Validates: Requirements 2.9, 6.5**
    - Add `fast-check` + Vitest + React Testing Library to `app/apps/web`
  - [x] 12.7 Write property test for empty sections
    - **Property 10: A section with no items shows an empty state while other sections render**
    - **Validates: Requirements 4.1**
  - [x] 12.8 Write property test for color-coded text labels
    - **Property 11: Color-coded signals always carry equivalent text**
    - **Validates: Requirements 4.6**
  - [x] 12.9 Write property test for framing highlight descriptions
    - **Property 12: Framing highlights expose a programmatic description**
    - **Validates: Requirements 4.8**
  - [x] 12.10 Write property test for issue-frame screen-reader text
    - **Property 13: Every issue-frame position has screen-reader text**
    - **Validates: Requirements 4.9**
  - [x] 12.11 Write property test for above-the-fold rendering
    - **Property 14: TLDR and the top framing signal render unexpanded on first paint**
    - **Validates: Requirements 4.10**
  - [x] 12.12 Write accent-color and contrast smoke tests
    - Assert no `#00ffe5` remains and the accent resolves to `#0d9488`; run an `axe` scan for AA contrast/ARIA wiring and ≤768px single-column layout (full WCAG conformance still needs manual review)
    - _Requirements: 1.9, 4.3, 4.4, 4.5_

- [x] 13. Deployment access-control integration tests
  - [x] 13.1 Write protected-route auth test
    - Protected routes return 401 without auth in the deployed configuration
    - _Requirements: 5.5_
  - [x] 13.2 Extend the rate-limit test
    - Exceeding the daily limit on new analyses returns 429 (extends `test/ratelimit.test.ts`)
    - _Requirements: 5.6_

- [x] 14. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- The invariant gate (`core/assemble.ts`) is intentionally not edited — Task 8 only verifies it, including that tier classification leaves its outcome unchanged (Property 21).
- The source-tier policy is a pure, offline function; all 21 properties target pure/decision logic and run with `fast-check` at a minimum of 100 iterations each.
- Each property test carries a `// Feature: trust-and-launch-bundle, Property {n}: ...` comment per the design's testing conventions.
- Checkpoints provide incremental validation between workstreams.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "5.1", "7.1", "10.1", "12.2"] },
    { "id": 1, "tasks": ["1.2", "4.2", "4.3", "7.2", "7.3", "7.8", "10.2", "12.3"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "2.1", "2.2", "2.3", "7.4", "7.5", "7.7", "8.1", "8.2", "8.3", "8.4", "8.5", "10.3"] },
    { "id": 3, "tasks": ["2.4", "5.2", "7.6", "7.10", "10.4", "10.5", "11.1", "12.1"] },
    { "id": 4, "tasks": ["5.3", "7.9", "11.2", "12.4"] },
    { "id": 5, "tasks": ["5.4", "5.5", "5.6", "5.7", "5.8", "11.3", "12.5"] },
    { "id": 6, "tasks": ["11.4", "12.6", "12.7", "12.8", "12.9", "12.10", "12.11", "12.12", "13.1", "13.2"] }
  ]
}
```
