# Implementation Plan: observability-instrumentation

## Overview

Add an **additive observability layer** — Sentry error monitoring + PostHog product analytics — behind one `Telemetry` port (`infra/ports.ts`), selected in the composition root (`compose.ts` `selectTelemetry()`) from `.env` flags, mirroring the existing `Cache`/`Queue`/`Repository`/`RateLimiter` wiring. The whole layer **only ever observes and verifies**: it never edits `core/assemble.ts`, never alters the pipeline output, and degrades to a frozen `No_Op_Telemetry` singleton with zero API keys (fail-open, never blocking startup or the pipeline).

The novel code is **pure logic** — `Redactor` (`redact.ts`), `Neutrality_Guard` (`neutrality.ts`), and the two `KPI_Deriver` functions (`kpi.ts`) — plus thin vendor wrappers (`active.ts`) where the SDKs live **only** inside the active impl module. Telemetry is emitted **after** `runPipeline` returns inside `handleJob`, never on the gate path, so Req 11.5/11.6/11.7 hold by construction. Implementation is TypeScript (server: `node:test` + `node:assert` + `fast-check` ≥100 runs; web: Vitest + `fast-check`). `fast-check` is already a devDependency; the only new deps are the vendor SDKs (`@sentry/node`, `posthog-node`, `posthog-js`). Each task builds on the prior ones and ends with the suite wired and green.

## Tasks

- [x] 1. Config + port scaffolding
  - [x] 1.1 Read telemetry config once in `src/config.ts`
    - Add `sentryDsn` and `posthogKey` to the exported `config` object, read once during module init from `SENTRY_DSN` / `POSTHOG_KEY` via the existing `process.env.X ?? default` pattern, exposed as the **verbatim trimmed** string, or `''` when unset or whitespace-only. Add an `isTelemetryConfigured`-style predicate that classifies a backend as "not configured" when its value is `''`.
    - Leave `missingRequiredConfig` **unchanged with respect to telemetry** — `SENTRY_DSN`/`POSTHOG_KEY` must never enter `missingRequiredConfig` in any mode, so absent telemetry config never blocks startup. Both API and Worker read the identical value from this single module (no drift).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.3_

  - [x] 1.2 Write property test for telemetry config (extend `test/config.test.ts`)
    - **Property 12: Telemetry config never blocks startup**
    - **Validates: Requirements 3.3, 2.2, 2.3, 2.4**
    - fast-check ≥100 runs, `node:test` + `node:assert`: for any env, `missingRequiredConfig(env, mode)` never includes `SENTRY_DSN`/`POSTHOG_KEY` in any mode, and the exposed `config` values equal the verbatim trimmed env string (or `''` when unset/whitespace-only). Carry the `// Feature: observability-instrumentation, Property 12: ...` + `Validates:` comment. (`test/config.test.ts` is already in the `package.json` test list — no wiring change.)

  - [x] 1.3 Declare the `Telemetry` port and the No_Op implementation
    - In `src/infra/ports.ts` add the `Telemetry` interface alongside `Cache`/`Queue`/`Repository`/`RateLimiter`: two **synchronous `void`** methods `emit(name, props?)` (Product_Analytics) and `capture(error, context?)` (Error_Monitor) — fire-and-forget, never returning an awaitable, so no call site can block on telemetry.
    - Add `src/infra/telemetry/noop.ts` exporting a frozen `noopTelemetry: Telemetry` singleton (`Object.freeze({ emit(){}, capture(){} })`) that accepts every call, emits nothing, opens zero connections, and never throws — the offline/zero-key default and the universal activation-failure fallback.
    - _Requirements: 1.1, 1.5, 3.1_

  - [x] 1.4 Write property test for the No_Op implementation (`test/telemetry.noop.test.ts`)
    - **Property 6: No_Op_Telemetry performs zero outbound emission and never throws**
    - **Validates: Requirements 3.4, 4.6, 9.6**
    - fast-check ≥100 runs: for any finite sequence of `emit`/`capture` calls with arbitrary names/contexts/payloads, assert zero outbound network connections (counting stub / no transport) and that every call returns without throwing. Carry the `// Feature/Property/Validates` comment.

- [x] 2. Pure redaction and neutrality
  - [x] 2.1 Implement the Redactor (`src/infra/telemetry/redact.ts`, pure)
    - Export `redact(payload, deniedValues?)`: returns a sanitized **deep copy**, never mutating input, never reading/writing external state. Remove any `Denied_Field` by case-insensitive key match against `DENIED_KEYS` (transcript, claimtext, rawclaim, jwt, token, apikey, api_key, authorization, secret, password, userid, user_id, email) at every depth, and scrub any value equal to a supplied denied literal. Preserve every non-denied field key-and-value unchanged. Total over null/undefined/primitives/arrays/nested/cyclic input (track visited objects with a `WeakSet` so a cycle resolves to a marker instead of recursing). Export `containsDeniedField(payload)` for the post-redaction residual assertion.
    - Leave one runnable assert-based self-check at the bottom (runnable via `node --import tsx src/infra/telemetry/redact.ts`, matching the `audit.ts`/`index.ts` convention): a nested payload with denied keys + a cyclic ref redacts to no-denied-field and a second pass is deep-equal.
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6_

  - [x] 2.2 Write property test (`test/telemetry.redact.noDenied.test.ts`)
    - **Property 1: Redaction never emits a Denied_Field**
    - **Validates: Requirements 5.2, 4.4, 9.5**
    - fast-check ≥100 runs over arbitrarily nested objects/arrays seeded with denied keys + denied literal values at any depth: assert the returned payload contains no denied key and no value equal to a supplied denied value, at every depth. Carry the comment.

  - [x] 2.3 Write property test (`test/telemetry.redact.idempotent.test.ts`)
    - **Property 2: Redaction idempotence**
    - **Validates: Requirements 5.3**
    - fast-check ≥100 runs: `redact(redact(p))` is deeply equal to `redact(p)`. Carry the comment.

  - [x] 2.4 Write property test (`test/telemetry.redact.preserve.test.ts`)
    - **Property 3: Redactor preserves non-denied fields and never mutates input**
    - **Validates: Requirements 5.5, 5.1**
    - fast-check ≥100 runs: every non-denied field (report ids, content ids, hashes, stage names, provider categories, counts, durations, Evidence_Outcome labels) survives key-and-value unchanged, and the caller's input object is deeply equal before and after the call. Carry the comment.

  - [x] 2.5 Write property test (`test/telemetry.redact.totality.test.ts`)
    - **Property 4: Redactor totality**
    - **Validates: Requirements 5.6**
    - fast-check ≥100 runs over null/undefined/primitives/arrays/deeply-nested/cyclic inputs: `redact` returns without throwing for any input (cyclic generator builds a normal object then assigns a self-reference on one branch and asserts return, not shape). Carry the comment.

  - [x] 2.6 Implement the Neutrality_Guard (`src/infra/telemetry/neutrality.ts`, pure)
    - Export `neutralityGuard(event): { pass: boolean; offendingKey? }` — pure, total, never throwing for any input incl. null/undefined/cyclic. Return `pass: false` on keys/values expressing a reliability/credibility/trust rating tied to a creator/author/person/channel, or a truthfulness/accuracy verdict about content (e.g. `creatorReliability`, `channelTrust`, `authorTier`, `truthVerdict`, `accuracyRating`, `isTrue`, `factVerdict`). Allow a `sourceTier` key **only** when it is not keyed by or co-located with a creator/channel/author/person identifier (source/citation tiers pass; person-attached tiers fail).
    - Leave one runnable assert-based self-check (runnable via `node --import tsx ...`): a source-tier-only event passes, a creator-reliability event fails with `offendingKey`, and a cyclic input returns without throwing.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 8.8, 11.4_

  - [x] 2.7 Write property test (`test/telemetry.neutrality.test.ts`)
    - **Property 5: Neutrality_Guard correctness and totality**
    - **Validates: Requirements 6.4, 6.7, 6.1, 6.2, 6.3, 6.5, 8.8, 11.4**
    - fast-check ≥100 runs: returns pass/fail without throwing for any input (incl. null/undefined/cyclic); passes when neither a creator/person/channel reliability dimension nor a content-truth verdict is present and fails when one is; a source tier passes only when describing a source/citation and not co-located with a creator/channel/author/person identifier. Carry the comment.

- [x] 3. KPI derivers
  - [x] 3.1 Implement the KPI_Deriver functions (`src/core/kpi.ts`, pure)
    - Export `citationCoverage(audits)`: pure, total, deterministic over per-claim `evidenceOutcome` only (no external call, no recomputation of any outcome). `CITED_OUTCOMES` = the three `matched_*`; `HONEST_NONE_OUTCOMES` = `relevant_context_only`/`no_sufficient_evidence`/`not_fact_checkable`. Coverage = |cited| / |claims carrying one of the six defined outcomes|, in `[0,1]`; empty list ⇒ exactly `0` (valid honest-none); an out-of-enum outcome is excluded from both numerator and denominator; input audits left unchanged.
    - Export `modelHumanAgreement(outcomes, signals)`: pair model outcomes with `HumanSignal`s (`expert_review` / `flag` / `dispute`) by `(reportId, claimId)`. Concurrence rule: `flag`/`dispute` = disagreement; `expert_review` `reviewStatus === 'expert-reviewed'` = agreement, `'under-dispute'` = disagreement (`'ai-generated'` is not a human signal, never paired). Return `undefined` when zero signals or no shared `(reportId, claimId)`; else `agreeing / compared` in `[0,1]`. Reference disputes/flags by report+claim id only — never the disputing/flagging user's identity, never attaching a result to a creator/channel. Declare the `ModelOutcome` / `HumanSignal` types.
    - Leave one runnable assert-based self-check: a mixed-outcome audit list yields the expected ratio and bounds; zero-signal agreement returns `undefined`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 3.2 Write property test (`test/kpi.citationCoverage.test.ts`)
    - **Property 9: Citation_Coverage is bounded, total, and classifies correctly**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8**
    - fast-check ≥100 runs over audit lists (incl. empty + out-of-enum outcomes): result is a finite real in `[0,1]`; equals |cited| / |defined-outcome claims| with honest-none counting toward denominator only; empty ⇒ `0`; out-of-enum excluded from both; input unchanged. Carry the comment.

  - [x] 3.3 Write property test (`test/kpi.agreement.test.ts`)
    - **Property 10: Model_Human_Agreement is bounded when paired and undefined otherwise**
    - **Validates: Requirements 8.1, 8.3, 8.4, 8.5, 8.6**
    - fast-check ≥100 runs over model outcomes + signals: `undefined` when zero signals or no shared `(reportId, claimId)`; else a finite real in `[0,1]` = agreeing/compared; identical output for identical input; disputes/flags referenced by report+claim id only. Carry the comment.

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Active telemetry implementation + composition-root selection
  - [x] 5.1 Implement the active Telemetry impl (`src/infra/telemetry/active.ts`)
    - Add `@sentry/node` and `posthog-node` to `app/apps/server/package.json` dependencies (pinned). Export `makeActiveTelemetry(deps)` returning a `Telemetry`: `emit` runs payload through `redact` (PII boundary), suppresses + warns (offending key only, no value) if `containsDeniedField` is still true, withholds if `neutralityGuard(...).pass` is false, then hands to `posthog.capture`; `capture` runs `redact(context)` then `sentry.captureException`. Wrap every send in a `safe()` helper that swallows any synchronous throw / async rejection (logs once) and abandons synchronous work after a ~50 ms best-effort budget — fail-open. SDK `init` (`@sentry/node` with `sendDefaultPii: false`; `posthog-node`) lives **only** in this module.
    - Leave one runnable assert-based self-check: a throwing stub backend does not propagate; a residual-denied payload is suppressed; a neutrality-failing event is withheld.
    - _Requirements: 1.5, 3.5, 4.4, 5.4, 5.7, 6.6, 9.7, 11.6, 11.7_

  - [x] 5.2 Write property test (`test/telemetry.failopen.test.ts`)
    - **Property 7: Active telemetry is fail-open**
    - **Validates: Requirements 3.5, 9.7, 11.7**
    - fast-check ≥100 runs: when the backend throws synchronously or rejects on every `emit`/`capture`, the active port contains the fault and returns without throwing or propagating. Also add a single non-PBT example asserting the `safe()` ≤50 ms best-effort budget abandons a deliberately slow stub. Carry the comment.

  - [x] 5.3 Add `selectTelemetry()` and wire `AppContext.telemetry` in `src/compose.ts`
    - Mirror `selectRepo`/`selectCache`/`selectQueue`: read `config.sentryDsn`/`config.posthogKey`; build the Sentry Error_Monitor when its DSN is non-empty and the PostHog Product_Analytics when its key is non-empty (each concern independently active or no-op, so "exactly one configured" activates only that one). When both are no-op return the shared `noopTelemetry`; emit exactly one `[infra]`-style startup log naming the selected backend(s) or `no-op`, and a warning naming any requested-but-uncredentialed / absent backend, without aborting. Wrap activation in try/catch: on init failure warn "telemetry initialization failure" and fall back to `noopTelemetry`. Add `telemetry: Telemetry` to `AppContext` and thread it into `makeWorker`/`makeRouter` exactly like `repo`/`cache`/`queue`/`limiter`, so both `index.ts` and `worker.ts` obtain it exclusively through `buildContext()`.
    - _Requirements: 1.2, 1.3, 1.4, 1.6, 1.7, 2.7, 3.2, 3.6, 10.1, 10.2, 10.3, 10.5_

  - [x] 5.4 Write selection example test (`test/telemetry.select.test.ts`)
    - example: each selection branch (both/neither/exactly-one configured) resolves the right impl; init-failure falls back to no-op; one startup log names the backend; warnings name skipped/absent backends; identical env ⇒ identical selection in both processes.
    - _Requirements: 1.2, 1.3, 1.4, 1.6, 1.7, 2.5, 2.7, 3.2, 3.6, 10.3, 10.5_

  - [x] 5.5 Write port-wiring example test (`test/telemetry.port.wiring.test.ts`)
    - example: `Redactor` + `Neutrality_Guard` are wired into `emit` (both) and `capture` (Redactor only); a residual-denied payload is suppressed with a redaction-failure indication; a neutrality-failing event is withheld with zero outbound.
    - _Requirements: 5.4, 5.7, 6.6_

- [x] 6. Error capture + operator metric call sites
  - [x] 6.1 Add the error-context builder and capture/emit in `src/worker.ts`
    - Add a pure context builder that outputs `{ reportId, stage, providerCategory }` with any undeterminable field set to the literal string `'unknown'` (never omitted, never a Denied_Field value); `providerCategory` ∈ `llm`/`evidence`/`perspective`/`transcript`/`unknown`. In `handleJob`: on the existing catch, call `telemetry.capture(err, ctx)` **exactly once** alongside the unchanged `failed` persist (status/error unchanged); after a run completes, emit one `pipeline_complete` event `{ reportId, status, durationMs, outcomeDistribution, citationCoverage }` — `durationMs` a non-negative integer measured with `Date.now()` around `runPipeline`, `outcomeDistribution` one non-negative integer per Evidence_Outcome from `result.audits`, `citationCoverage` = `citationCoverage(result.audits)`. Keep the `assertInvariantGateIntact` boot guard and `core/assemble.ts` **verify-only — never edited**; emit only **after** `runPipeline` returns (never on the gate path).
    - _Requirements: 4.2, 4.3, 4.5, 4.7, 9.2, 9.3, 11.1, 11.3, 11.5_

  - [x] 6.2 Write property test (`test/telemetry.context.test.ts`)
    - **Property 11: Unknown-context substitution is total and safe**
    - **Validates: Requirements 4.7, 4.3**
    - fast-check ≥100 runs over partial error-context objects: output always carries `reportId`/`stage`/`providerCategory`, any undeterminable field is the literal `'unknown'` (not omitted), and the substituted value never equals a Denied_Field value. Carry the comment.

  - [x] 6.3 Capture in the Express error handler (`src/index.ts`)
    - In the Express error handler, after the existing `console.error`, call `telemetry.capture(err, ctx)` **exactly once**. The HTTP status code and response body returned to the client are unchanged by the capture.
    - _Requirements: 4.1, 4.8_

  - [x] 6.4 Emit operator metrics in `src/http/routes.ts`
    - On a cache hit: `telemetry.emit('cache_hit', { submissionId, cached: true })`; on a queued miss: `telemetry.emit('cache_miss', { submissionId })` (`submissionId` = existing `urlHash`/`report.id`). After the existing dispute/flag persist: `telemetry.emit('dispute'|'flag', { reportId, claimId })`. No user id is ever emitted. Events carry only ids, categorical labels, non-negative integer counts, and non-negative ms durations; emission failure never propagates to the in-progress cache resolution / dispute / flag.
    - _Requirements: 8.2, 8.7, 9.1, 9.4, 9.5, 9.7_

  - [x] 6.5 Write call-site example test (`test/telemetry.callsites.test.ts`)
    - example with a recording stub: cache hit/miss emit the right event + label; dispute/flag emit `{reportId, claimId}` with no user id; worker `pipeline_complete` carries status/durationMs/outcomeDistribution/citationCoverage; `capture` fires exactly once on worker failure and in the error handler; HTTP status/body and persisted `failed` status unchanged.
    - _Requirements: 4.1, 4.2, 4.5, 4.8, 8.2, 8.7, 9.1, 9.2, 9.3, 9.4_

  - [x] 6.6 Write property test (`test/telemetry.invariance.test.ts`)
    - **Property 8: Offline / telemetry-invariance of the pipeline report**
    - **Validates: Requirements 3.7, 11.2, 11.3, 11.7**
    - fast-check ≥100 runs over random analysis inputs + deterministic mock providers (offline, in-memory): the worker's persisted report is field-by-field equal (`status`, `reasons`, claims, citations, audits, context) under active vs no-op telemetry, excluding only the per-claim `randomUUID` ids and timestamps already non-deterministic today. Carry the comment.

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Web-side analytics
  - [x] 8.1 Implement the web analytics wrapper (`apps/web/src/analytics.ts`)
    - Add `posthog-js` to `app/apps/web/package.json`. Export a pure `buildWebEvent(name, props)` (the web analogue of `Redactor` + `Neutrality_Guard`) that strips raw claim text, transcript text, JWTs, and user identifiers and any creator/channel reliability dimension. Export `track(name, props)` (fire-and-forget, no render side effects), `grantConsent()`, and `hasConsent()` (backed by a single `localStorage` `fs_analytics_consent` boolean). Read `import.meta.env.VITE_POSTHOG_KEY`: absent ⇒ no-op returning within the same synchronous tick with zero outbound and never blocking render. Until consent is granted, `track` emits nothing; after grant, subsequent calls emit. Any outbound failure is discarded silently.
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 8.2 Write property test (`apps/web` `src/analytics.event.test.ts`)
    - **Property 13: Web events carry no PII or creator dimension and degrade to a no-op**
    - **Validates: Requirements 12.3, 12.4**
    - fast-check ≥100 runs under Vitest: `buildWebEvent` returns an event with no raw claim/transcript text, no JWT, no user id, and no creator/channel reliability dimension; and for any sequence of `track` calls while `VITE_POSTHOG_KEY` is unset, zero outbound emission and synchronous return without throwing. Carry the comment.

  - [x] 8.3 Wire web call sites (view + interaction events)
    - In `App.tsx` hash-route `useEffect`: `track('view', { route, reportId })` exactly once per view. In `Report.tsx`: `track('flag', { reportId })` on flag submit and `track('share', { reportId })` on share; in `DisputeModal.tsx`: `track('dispute', { reportId })` on dispute submit. Events carry route + report id + category only. `track` has no render side effects, so the rendered DOM, hash navigation, and accessibility tree are identical whether active or no-op.
    - _Requirements: 12.1, 12.2, 12.8_

  - [x] 8.4 Write web consent/interaction example test (`apps/web` `src/analytics.consent.test.tsx`)
    - example under Vitest + React Testing Library: consent gate withholds until granted then emits; view + dispute/flag/share emit the right category + report id; an outbound failure leaves render/routing/a11y unaffected; the rendered DOM and accessibility tree are identical active vs no-op.
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.7, 12.8_

- [x] 9. Wire the test suite and verify green
  - [x] 9.1 Register server tests and extend the boot smoke test
    - Add every new `test/telemetry.*.test.ts` and `test/kpi.*.test.ts` file by name to the explicit `test` list in `app/apps/server/package.json` (the extended `test/config.test.ts` is already listed). Extend `test/build.smoke.test.ts`: boot with no telemetry keys reaches `app.listen` on `config.port`; only the active impl module imports the vendor SDKs (no other server module imports `@sentry/node`/`posthog-node`); `core/assemble.ts` is unchanged; telemetry is initialized before serving/processing.
    - _Requirements: 1.1, 1.5, 3.1, 10.1, 10.2, 10.4, 10.6, 11.1, 11.5, 13.1, 13.2_

  - [x] 9.2 Run the gates in both packages
    - Run `npm test` and `npm run typecheck` in `app/apps/server`; run `npx vitest run` and `tsc -b` in `app/apps/web`. Confirm all are green (zero failing assertions, no type errors), with every property at ≥100 runs and carrying its `// Feature/Property/Validates` comment.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks (property tests + the example/integration/smoke checks); they can be skipped for a faster MVP but each is required for the Req 13 verification gate. Every property test carries the `// Feature: observability-instrumentation, Property <n>: ...` + `Validates: Requirements …` comment and runs offline (mock providers + in-memory infra + stub backends, ≥100 runs, zero outbound network).
- **Verify-only — never edited:** `core/assemble.ts` (the invariant gate) and the existing `assertInvariantGateIntact` boot guard. Telemetry is emitted only **after** `runPipeline` returns, never on the gate path (Req 11.1, 11.3, 11.5–11.7 hold by construction).
- Vendor SDKs (`@sentry/node`, `posthog-node`, `posthog-js`) live **only** inside the active impl modules (`active.ts` / `analytics.ts`); every other module speaks the `Telemetry` interface (Req 1.5).
- The `Telemetry` port methods are synchronous `void` and fail-open: a telemetry fault is contained, logged once, and never reaches the pipeline, the HTTP path, or startup.
- The 50 ms best-effort budget (Req 11.6) is an example assertion on `safe()`, not a property — wall-clock timing is not PBT material.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "2.1", "2.6", "3.1", "8.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.2", "2.3", "2.4", "2.5", "2.7", "3.2", "3.3", "5.1", "8.2", "8.3"] },
    { "id": 2, "tasks": ["5.2", "5.3", "8.4"] },
    { "id": 3, "tasks": ["5.4", "5.5", "6.1", "6.3", "6.4"] },
    { "id": 4, "tasks": ["6.2", "6.5", "6.6"] },
    { "id": 5, "tasks": ["9.1"] },
    { "id": 6, "tasks": ["9.2"] }
  ]
}
```
