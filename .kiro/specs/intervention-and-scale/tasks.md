# Implementation Plan: Intervention & Scale

## Overview

This plan implements the three individually-gated capabilities (Feed Friction Dial, Institutional GraphQL API, Creator pre-publish coaching) onto the **unchanged** analysis engine. Work proceeds foundation-first: the additive migration, `ports.ts` interfaces, and both Repository drivers land before any capability so the offline-first parity path is intact from the start. Each capability is then built pure-core-first (trust gate, projections, engine), wired into `http/routes.ts` behind the trust gate and the `neutralityGuard` response boundary, and verified by property tests close to the code they cover.

Implementation language is **TypeScript** (server: Node + Express, `node:test`, ESM extensionless imports; web/Extension: Vitest). Property tests use **`fast-check`** with a **minimum of 100 runs** per property. Every property test carries the comment `// Feature: intervention-and-scale, Property <n>: <description>` plus a `Validates: Requirements …` reference. New server test files are registered into the explicit `test/*.test.ts` list in `apps/server/package.json` by the final wiring task.

Three rules carry the compass and the moat through every task: satisfy the gate by construction (no path calls `assembleReport`), lens-not-judge at every boundary (`neutralityGuard` before send), and DI through `ports.ts` with in-memory + Postgres parity.

## Tasks

- [x] 1. Data layer foundation — additive migration, ports, both drivers
  - [x] 1.1 Add migration `008_intervention_and_scale.sql`
    - Create `app/db/migrations/008_intervention_and_scale.sql` with the additive tables `api_keys` (hash-only, `revoked_at`, optional `rate_max`/`rate_window_s` with `CHECK 1..86400`, partial active-key index), `api_key_rate_windows`, and `trust_gate_config` (per-capability rows with range checks)
    - Additive only: no `ALTER`/`DROP` on existing tables; three-digit prefix sorts lexically after `007`
    - _Requirements: 6.7, 6.8, 8.4, 14.3, 14.4_

  - [x] 1.2 Extend `infra/ports.ts` with new Repository/port method signatures
    - Add API-key methods (`createApiKey`, `findApiKeyByHash`, `revokeApiKey`, `countActiveApiKeys`), per-key rate-limit (`institutionalHit` + `RateLimitConfig`), trust-gate config read, read-only metric aggregates (`listEvidenceOutcomes`, `listHumanSignals`), and read-only Report_Graph query methods (`queryClaims`, `listCitationsForClaim`, `listPerspectivesForReport`, `aggregateByDomain`, `aggregateByTopic`)
    - Types only; no implementation. Keep all new reads read-only over already-persisted data
    - _Requirements: 14.1, 9.1, 9.4_

  - [x] 1.3 Implement new methods on `InMemoryRepository` (`infra/memory.ts`)
    - Back keys/windows/trust-config with `Map`s; deterministic field/array ordering identical to Postgres for identical inputs
    - Offline (no keys/config) returns empty/default results, never throws, no error-level logs
    - _Requirements: 14.2, 14.6, 9.5_

  - [x] 1.4 Implement new methods on `PostgresRepository` (`infra/postgres.ts`)
    - Parameterized SQL only (no string interpolation of inputs); enforce ≤10 active keys inside `createApiKey`; revocation via `revoked_at`; propagate DB errors to caller with no partial write
    - Report_Graph reads are SELECT-only against `claims`/`citations`/`perspective_links`
    - _Requirements: 9.1, 9.2, 9.4, 14.2, 14.5, 14.8_

  - [x] 1.5 Add zod schemas to `http/validation.ts`
    - Friction query: required `url` string; coaching body: `draft` string with trimmed length 1..50000
    - _Requirements: 10.5_

  - [x] 1.6 Write property test for Repository driver parity and offline safety
    - **Property 22: Repository drivers agree, and offline operations are safe**
    - In-memory and Postgres return deep-equal results with identical field/array ordering for identical input sequences; offline key/rate/trust ops return default/empty without throwing or error logs
    - New file `test/intervention.repositoryParity.prop.test.ts` (Postgres leg runs under `test:integration` when a DB is available)
    - **Validates: Requirements 14.2, 14.6**

- [x] 2. Trust gate, metrics source, and per-capability config
  - [x] 2.1 Implement `core/trustGate.ts`
    - Pure, total `evaluateTrustGate(metrics, thresholds)`: satisfied iff coverage defined and `> min` AND agreement defined and `> min` AND `legalReviewComplete === true`; any undefined metric → not satisfied; never throws; returns `{ satisfied, reasons }`
    - _Requirements: 1.5, 1.6, 12.2_

  - [x] 2.2 Write property tests for the trust gate
    - **Property 1: Trust gate is the strict three-way conjunction over defined metrics**
    - **Property 2: Per-capability trust thresholds are independent**
    - **Property 3: Trust gate hot-reloads — verdict always reflects current values**
    - New file `test/intervention.trustGate.prop.test.ts`
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.9, 12.2, 12.3, 12.4, 12.5**

  - [x] 2.3 Add per-capability trust-gate config to `config.ts`
    - Parse `TRUST_{FEED,API,COACH}_{COVERAGE,AGREEMENT}_MIN` and `_LEGAL_OK` from env via existing env helpers; default `0.0` / `false`; expose a `Record<Capability, TrustThresholds>`; optional repo override with env as the floor
    - Read live every evaluation; never hard-code passing values
    - _Requirements: 1.5, 1.7, 1.8, 12.2, 12.4, 12.6_

  - [x] 2.4 Implement `core/metricsStore.ts`
    - `buildTrustMetrics({ repo })` feeds `listEvidenceOutcomes`/`listHumanSignals` into the existing pure `kpi.citationCoverage`/`kpi.modelHumanAgreement`; no new metric math; offline → `{ coverage: 0, agreement: undefined }` (fail-closed)
    - _Requirements: 1.6, 1.8, 14.6_

  - [x] 2.5 Write unit test for `metricsStore` aggregation
    - Verify coverage/agreement pass-through and the empty-data fail-closed defaults
    - _Requirements: 1.6, 1.8_

- [x] 3. Neutrality response boundary
  - [x] 3.1 Add an outbound neutrality boundary helper (`http/respond.ts`)
    - One `sendNeutral(res, status, payload)` that runs the existing `neutralityGuard` (`infra/telemetry/neutrality.ts`) and delivers the payload unchanged on pass, withholds entirely on fail (no partial delivery). Used by all three capabilities at the send site
    - _Requirements: 15.7_

  - [x] 3.2 Write property tests for the neutrality boundary
    - **Property 4: Neutrality is enforced at every outbound boundary**
    - **Property 5: The neutrality guard withholds any failing payload**
    - **Property 6: The neutrality guard is total** (null/undefined/primitives/arrays/deeply nested/cyclic — never throws)
    - Generate adversarial payloads (creator+tier co-location, truth-verdict keys, cyclic structures) alongside legitimate generated payloads; new file `test/intervention.neutralityBoundary.prop.test.ts`
    - **Validates: Requirements 2.4, 4.1, 4.2, 4.5, 4.6, 7.7, 11.2, 11.3, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8**

- [x] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Feed Friction Dial — server
  - [x] 5.1 Implement `core/frictionOverlay.ts`
    - Pure `projectFrictionOverlay(report, baseUrl)`: one signal per report framing signal (verbatim technique/quote/explanation), highest-severity-first with report-data order as the stable tie-break, one evidence item per claim with `evidenceStrength` label, honest-none for `none`, the report URL; structurally emits no verdict, no creator field, no aggregate score
    - _Requirements: 2.2, 3.3, 4.3, 4.4, 4.6, 15.1, 15.6_

  - [x] 5.2 Write property tests for the friction overlay projection
    - **Property 7: Friction overlay projection is faithful and label-bounded**
    - **Property 8: Friction is served only for existing, ready reports** (projection/serve returns overlay only for existing `ready` reports)
    - Use `test/reportGraph.arb.ts` gate-valid report generator; new file `test/intervention.frictionOverlay.prop.test.ts`
    - **Validates: Requirements 2.2, 2.3, 3.3, 4.3, 4.4, 4.6**

  - [x] 5.3 Add `GET /api/v1/friction` route (`http/routes.ts`)
    - Public route: evaluate Feed_Friction trust gate (not satisfied → 503 `capability_unavailable`); normalize url via existing content hash → `repo.findContentByHash`; missing or `status !== 'ready'` → 404; project overlay and send via `sendNeutral` (guard fail → withhold/404)
    - _Requirements: 1.1, 1.4, 2.2, 2.3, 5.6, 15.7_

  - [x] 5.4 Write example test for the friction route
    - Per-capability 503 routing when gate dark; 404 for missing/non-ready; 200 lens-safe payload when gate satisfied; new file `test/intervention.friction.route.test.ts`
    - _Requirements: 1.4, 2.3, 5.1, 5.6_

- [x] 6. Feed Friction Dial — Extension friction module (web/Vitest)
  - [x] 6.1 Implement Extension pure logic (friction module of the Extension package)
    - `normalizeFeedUrl(raw)` matching the server's content-hash normalization; `resolveIntensity(stored)` → member of `{subtle, moderate, interruptive}`, default `moderate` for null/unknown/error, never throws; `intensityStore` persisting to `chrome.storage.local` with in-memory `moderate` fallback when storage is unavailable
    - _Requirements: 2.1, 3.1, 3.5, 3.6, 3.7_

  - [x] 6.2 Write property tests for normalization and intensity (Vitest)
    - **Property 9: Feed URL normalization matches the stored content hash**
    - **Property 11: Intervention intensity resolves to a valid level and round-trips**
    - New file `frictionClient.prop.test.ts` under the web/Extension Vitest suite
    - **Validates: Requirements 2.1, 3.5, 3.6, 3.7**

  - [x] 6.3 Implement friction client, overlay renderer, and accessibility wiring
    - `fetchOverlay(url)` resolves `null` on 404/503/network/>5s-timeout (render nothing, no error UI), issues only the read-only friction GET (never `POST /analyses`), gate-dark poll ≤ every 5 min, viewport re-check within 10s on reconnect
    - Intensity-driven rendering (subtle badge ≤32×32 / moderate inline card / interruptive obscuring overlay), "learn more" opens `reportUrl` in a new tab, dismiss/expand actions, ARIA roles/names, polite live region, visible focus indicator, focus return on dismiss, focus trap when interruptive, color-never-alone labels
    - _Requirements: 2.5, 2.6, 2.7, 3.2, 3.3, 3.4, 3.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 16.1, 16.2, 16.3, 16.4, 16.5, 16.7_

  - [x] 6.4 Write property + component tests for the client and overlay (Vitest)
    - **Property 10: Friction client renders nothing on any non-success outcome and never triggers analysis**
    - Plus component tests: per-intensity rendering, learn-more new-tab, dismiss focus return, focus trap, ARIA/keyboard/live-region wiring
    - **Validates: Requirements 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.8, 5.2, 5.3, 5.4, 5.5, 5.6, 16.1, 16.2, 16.3, 16.4, 16.5, 16.7**

- [x] 7. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Institutional API — authentication and key management
  - [x] 8.1 Implement `apiKeyAuth` middleware (`http/auth.ts`)
    - Read `Authorization` header, hash presented key (SHA-256), `repo.findApiKeyByHash`; missing/malformed/revoked/unknown → 401 with query not executed and not rate-counted; separate path from the reader JWT
    - _Requirements: 6.2, 6.3, 6.5, 8.7_

  - [x] 8.2 Add institutional key-admin routes (`http/routes.ts`)
    - `POST /institutions/:institutionId/keys` → `randomBytes(32).toString('base64url')`, persist `sha256` only, return plaintext once; map active-key limit to 409; `DELETE …/keys/:keyId` revokes (effective ≤60s); `GET …/keys/:keyId/value` → 404 always
    - _Requirements: 6.1, 6.4, 6.7, 6.8_

  - [x] 8.3 Write property tests for keys and auth
    - **Property 12: API keys are URL-safe, high-entropy, unique, and hash-only persisted**
    - **Property 13: API-key authentication accepts only live issued keys**
    - **Property 14: Active-key limit holds at the boundary**
    - New file `test/intervention.apiKey.prop.test.ts`
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 8.7**

  - [x] 8.4 Write edge test for the active-key limit
    - 11th active-key creation returns 409 and persists no new key; new file `test/intervention.activeKeyLimit.test.ts`
    - _Requirements: 6.7_

- [x] 9. Institutional API — per-key rate limiting
  - [x] 9.1 Implement the per-key institutional rate limiter (`concurrency.ts`)
    - `institutionalHit(keyId, cfg)` fixed-window in the existing `RateLimitResult` shape; per-key `(maxRequests, windowSeconds∈[1,86400])`; default `100 / 60s` when unconfigured; in-memory + Redis/Postgres window parity
    - _Requirements: 8.2, 8.4, 8.5, 8.6_

  - [x] 9.2 Write property test for the rate limiter
    - **Property 18: Per-key rate limiting is correct and isolated**
    - `remaining === max(0, max - count)`, allow while `count ≤ max`, 429 + whole-second `Retry-After` once exceeded, reset after window, per-key isolation; new file `test/intervention.institutionalRateLimit.prop.test.ts`
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.6**

  - [x] 9.3 Write example test for the default rate config
    - Unconfigured key applies `100 / 60s`; new file `test/intervention.rateLimitDefault.test.ts`
    - _Requirements: 8.5_

- [x] 10. Institutional API — GraphQL schema, resolvers, endpoint
  - [x] 10.1 Add `graphql` dependency and the read-only schema (`graphql/schema.ts`)
    - Pin `graphql` (graphql-js) as the single new runtime dependency; `buildSchema` exposing `claims`/`citations`/`perspectiveLinks`/`claimFrequency`/`sourceDomainFrequency`/`topicDistribution`/`domainAggregates`/`topicAggregates`; no type/field associating a reliability metric with a person/channel
    - _Requirements: 7.6, 7.7, 15.5_

  - [x] 10.2 Implement read-only resolvers (`graphql/resolvers.ts`)
    - Resolvers call only Report_Graph Repository read methods (no resolver-side SQL, no write path); `pageSize` clamped `[1,200]` default 50; response carries `totalCount/pageOffset/hasNextPage`; empty matches → `{ items: [], totalCount: 0 }`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.9, 7.10, 9.1, 9.2, 9.3, 9.4_

  - [x] 10.3 Add `POST /api/v1/graphql` endpoint (`http/routes.ts`)
    - Behind `apiKeyAuth` then the per-key limiter (429 + `Retry-After` + `X-RateLimit-*`); evaluate Institutional trust gate (503 when dark); call `graphql({ schema, source, … })` (invalid syntax/unknown field → structured `errors`, resolvers not run); send serialized `data` via `sendNeutral`
    - _Requirements: 1.2, 1.4, 7.6, 7.8, 8.1, 8.3, 9.5, 15.7_

  - [x] 10.4 Write property tests for GraphQL querying
    - **Property 15: GraphQL claim queries respect filters, pagination, and metadata**
    - **Property 16: GraphQL citation and perspective results carry their required fields**
    - **Property 17: GraphQL aggregates equal a direct recomputation**
    - New file `test/intervention.graphqlQuery.prop.test.ts`
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.9, 7.10, 9.3**

  - [x] 10.5 Write example test for the GraphQL endpoint
    - Invalid-syntax/unknown-field → `{ errors }` with resolvers not run; empty corpus → empty result no error; read-only/in-memory resolution; new file `test/intervention.graphql.route.test.ts`
    - _Requirements: 7.6, 7.8, 9.1, 9.4, 9.5_

- [x] 11. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Creator pre-publish coaching
  - [x] 12.1 Implement `core/coaching.ts`
    - `analyzeDraft(draft, { llm })`: ≤20 issues, framing issues carry technique + quote (≤300 chars) + explanation + suggestion, unsupported-claim issues carry quote (≤300) + explanation + suggestion, advisory phrasing only (no imperative/blocking wording), `noIssues` when none; holds no Repository/Queue/Telemetry-of-content handle (cannot persist), never feeds the pipeline
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 12.2 Write property tests for the coaching engine
    - **Property 19: Coaching responses are well-formed, honest, and advisory**
    - **Property 20: Coaching persists nothing** (no repo write, no enqueue, no report, no draft/response/identity in logs or telemetry)
    - New file `test/intervention.coaching.prop.test.ts`
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 11.1, 11.4, 11.5, 11.6, 13.5, 15.4**

  - [x] 12.3 Add `POST /api/v1/coaching` route (`http/routes.ts`)
    - `requireAuth`; zod draft validation (1..50000 trimmed → else 400, engine not invoked); coaching trust gate (503 when dark); per-user rolling 10/60s limiter keyed by `user:<jwt sub>` (429); ≤30s budget, timeout/internal error → 500 `coaching_unavailable` with nothing persisted; send via `sendNeutral`
    - _Requirements: 10.5, 10.6, 10.7, 10.8, 11.7, 12.1, 15.7_

  - [x] 12.4 Write validation/edge tests for the coaching route
    - Empty/whitespace/>50000 → 400 (engine not invoked); no token → 401; >10/60s → 429; induced timeout/error → 500 with nothing persisted; new file `test/intervention.coachingValidation.test.ts`
    - _Requirements: 10.5, 10.6, 10.7, 10.8, 11.7, 12.1_

- [x] 13. Invariant protection and readiness immutability
  - [x] 13.1 Add the CI diff guard for invariant-protected files
    - A small check (wired into `test:build` / a check script) that fails the build if this feature's diff touches `core/assemble.ts` or `pipeline/stages.ts`; runs alongside the existing `test/invariant.test.ts`
    - _Requirements: 13.1, 13.4, 13.6_

  - [x] 13.2 Write property test for readiness/persistence immutability
    - **Property 21: Serving leaves readiness and the persisted report unchanged**
    - No serving path calls `assembleReport`; status consumed equals stored status; `analysis_reports` + Report_Graph rows unchanged; Report_Graph never written by any GraphQL path; new file `test/intervention.readinessImmutability.prop.test.ts`
    - **Validates: Requirements 9.2, 13.2, 13.3, 13.5**

- [x] 14. Wiring and registration
  - [x] 14.1 Wire dependencies and mount routes in `compose.ts`
    - Select in-memory vs Postgres for the new Repository methods and the institutional limiter by `.env`; build `metricsStore`; pass trust config; mount friction/keys/graphql/coaching routes; keep the zero-keys offline path (in-memory + mocks) working
    - _Requirements: 14.1, 14.6, 14.7_

  - [x] 14.2 Register new server test files in `apps/server/package.json`
    - Add the created `test/intervention.*.test.ts` files to the explicit `test` script list (slow/Postgres-dependent ones to `test:integration`); leave skipped optional files out
    - _Requirements: (build/test wiring)_

- [x] 15. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise. Run `npm test` + `npm run typecheck` in `apps/server` and `npx vitest run` + `tsc -b` in `apps/web`.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirement clauses for traceability; property test sub-tasks each reference a numbered property from the design's Correctness Properties section.
- Property-based tests use `fast-check` (min 100 runs), reuse `test/reportGraph.arb.ts` gate-valid report generators where possible, and carry the required `// Feature: intervention-and-scale, Property <n>: …` comment plus a `Validates: Requirements …` reference.
- UI rendering, ARIA/keyboard/contrast, timing windows, CI diff guard, and migration shape are covered by component/example/smoke tests, not property tests (per the design Testing Strategy).
- The feature is read-mostly and additive: no task edits `core/assemble.ts` or `pipeline/stages.ts`; `neutralityGuard` at the response boundary is the runtime backstop on every outbound payload.
- Checkpoints provide incremental validation at capability boundaries.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.5", "2.1", "3.1", "5.1", "6.1", "10.1", "12.1", "13.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "2.2", "2.3", "2.4", "3.2", "5.2", "6.2", "6.3", "12.2"] },
    { "id": 2, "tasks": ["1.6", "2.5", "6.4", "8.1", "9.1", "10.2"] },
    { "id": 3, "tasks": ["5.3", "8.3", "8.4", "9.2", "9.3", "10.4", "13.2"] },
    { "id": 4, "tasks": ["5.4", "8.2"] },
    { "id": 5, "tasks": ["10.3"] },
    { "id": 6, "tasks": ["10.5", "12.3"] },
    { "id": 7, "tasks": ["12.4", "14.1"] },
    { "id": 8, "tasks": ["14.2"] }
  ]
}
```
