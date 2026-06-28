# Requirements Document

## Introduction

The f-Socials roadmap (`f-Socials-roadmap.md` §7) gates **"P1 — Observability before pilots"** as a prerequisite before any pilots, for one concrete reason restated in `f-Socials-debt-and-todo.md`: *"The red-line trust KPIs (citation coverage, model-vs-human agreement) can't be measured without event capture."* This feature wires error/exception monitoring (Sentry) and product/event analytics (PostHog) into the existing modular-monolith server — the two long-running processes that share one composition root (`index.ts` API + `worker.ts` worker via `compose.ts`) — and into the web app (`apps/web`), so that:

- Unhandled errors and pipeline failures are captured with debugging context (which Stage, report id, provider) without leaking analyzed content.
- The two **red-line trust KPIs** become measurable: **Citation_Coverage** (the share of verified Claims that reach a cited Evidence_Outcome versus an honest no-evidence outcome) and **Model_Human_Agreement** (report Evidence_Outcomes compared against the human signals — expert review, flag, dispute).
- Operators can observe analysis throughput, cache hit/miss rate, end-to-end latency, Evidence_Outcome distribution, and dispute/flag rates.

This is an additive observability layer. It only ever **observes and verifies** the existing pipeline; it never alters analysis behavior, never weakens the invariant gate (`core/assemble.ts`), and must keep the offline-first, zero-API-key path working exactly as today.

Five project invariants from the steering Compass and the existing seams shape every requirement below and are non-negotiable:

1. **Lens, not a judge.** Telemetry must never capture, derive, or transmit a creator-reliability or content-truth verdict, and must never attach any reliability dimension to a person or channel. Source tiers attach to sources/citations only.
2. **The invariant gate must not be weakened or modified.** Observability only observes/verifies `core/assemble.ts`; it never edits it.
3. **Offline-first / zero-API-key path keeps working.** With no `SENTRY_DSN` / `POSTHOG_KEY` configured, the server and worker run exactly as today — instrumentation degrades to a no-op (fail-open for telemetry; never blocking startup or the pipeline), mirroring the existing degrade-and-warn pattern in `index.ts`/`config.ts`.
4. **Established wiring pattern.** Telemetry sits behind an interface/port in `src/infra/ports.ts` and is selected in the composition root (`compose.ts`), exactly as Cache/Queue/Repository/RateLimiter and providers are wired. Config is read once in `src/config.ts` using the existing `Number(process.env.X ?? default)` / `boolEnv` pattern.
5. **PII / secret hygiene.** Transcripts, raw claim text, JWTs, API keys, and user identifiers must never reach a telemetry payload. Events carry ids and metrics, not raw analyzed content. This is a trust boundary.

## Glossary

- **Telemetry**: The combined error-monitoring and product-analytics capability introduced by this feature.
- **Telemetry_Port**: The interface in `app/apps/server/src/infra/ports.ts` through which the rest of the server emits telemetry, mirroring the existing `Cache`/`Queue`/`Repository`/`RateLimiter` ports. Its concrete implementation is chosen in the Composition_Root.
- **Error_Monitor**: The error/exception-capture concern, backed by Sentry when configured.
- **Product_Analytics**: The product/event-analytics concern, backed by PostHog when configured.
- **Composition_Root**: `app/apps/server/src/compose.ts`, where infra drivers and providers are selected from `.env` flags and assembled into the `AppContext`.
- **API_Server**: The API entrypoint process `app/apps/server/src/index.ts`.
- **Worker**: The worker entrypoint process `app/apps/server/src/worker.ts`.
- **Pipeline**: The `runPipeline` analysis flow in `app/apps/server/src/pipeline/stages.ts` (transcript → extract → verify claims → perspectives → assemble/gate).
- **Stage**: One of the named Pipeline stages (transcript, extraction, claim verification, perspectives, assemble/gate).
- **Invariant_Gate**: The report-readiness gate in `app/apps/server/src/core/assemble.ts`.
- **Evidence_Outcome**: One of the six router outcomes in `app/apps/server/src/types.ts` — `matched_fact_check`, `matched_primary_source`, `matched_institutional_source`, `relevant_context_only`, `no_sufficient_evidence`, `not_fact_checkable`.
- **Cited_Outcome**: The three `matched_*` Evidence_Outcomes — the outcomes that carry at least one ledger citation (`evidenceStrength` ≠ `none`).
- **Honest_None_Outcome**: An Evidence_Outcome that carries zero ledger citations — `relevant_context_only`, `no_sufficient_evidence`, or `not_fact_checkable` (`evidenceStrength` = `none`).
- **Citation_Coverage**: The red-line trust KPI defined as the share of a report's verified Claims whose Evidence_Outcome is a Cited_Outcome, expressed as a real number in the inclusive range 0 to 1.
- **Human_Signal**: A human review input recorded against a report — an expert review (`expert_reviews` / `provenance.reviewStatus`), a flag (`createFlag`), or a dispute (`createDispute`).
- **Model_Human_Agreement**: The red-line trust KPI that compares a report's model-produced Evidence_Outcomes against the Human_Signals recorded for that report.
- **KPI_Deriver**: The pure function(s) that compute Citation_Coverage and Model_Human_Agreement inputs from already-produced report data (Claims, audits, Human_Signals).
- **Redactor**: The pure function that shapes and sanitizes a telemetry payload before emission, removing or omitting denied fields (transcripts, raw claim text, JWTs, API keys, user identifiers).
- **Denied_Field**: Any field whose value must never appear in a telemetry payload: transcript text, raw claim text, JWTs, API keys/secrets, and user identifiers.
- **Neutrality_Guard**: The check asserting that no creator-reliability or content-truth verdict, and no person/channel reliability dimension, is present in any telemetry payload.
- **Web_Analytics**: The web-side (`apps/web`) product-analytics integration for page/report views and dispute/flag/share interactions.
- **Offline_Mode**: The zero-API-key configuration in which `SENTRY_DSN` and `POSTHOG_KEY` are unset, mock providers and in-memory infra are selected, and Telemetry degrades to a no-op.
- **No_Op_Telemetry**: A Telemetry_Port implementation that accepts every call, emits zero outbound events, and never throws.
- **Telemetry_Event**: A single named record emitted to Product_Analytics, carrying a name and a property bag of ids and metrics.

## Requirements

### Requirement 1: Telemetry behind a port, selected in the composition root

**User Story:** As a maintainer of the modular monolith, I want telemetry to sit behind an interface and be selected in the composition root from `.env` flags, so that it follows the same dependency-injection pattern as every other infra concern and can be swapped or disabled without touching call sites.

#### Acceptance Criteria

1. THE Telemetry_Port SHALL be declared as an interface in `app/apps/server/src/infra/ports.ts`, alongside the existing `Cache`, `Queue`, `Repository`, and `RateLimiter` interfaces.
2. THE Composition_Root SHALL construct exactly one concrete Telemetry_Port implementation in a dedicated selection function and SHALL expose that single instance on the `AppContext`, mirroring the existing `select*` functions for infra drivers.
3. WHERE a telemetry backend's required environment variable(s) are present and non-empty, THE Composition_Root SHALL construct the corresponding active Telemetry_Port implementation for that backend.
4. WHERE no telemetry backend has its required environment variable(s) present and non-empty, THE Composition_Root SHALL construct the No_Op_Telemetry implementation, which accepts every call and performs no outbound emission.
5. THE server modules outside the Telemetry_Port implementation modules SHALL emit telemetry only through the Telemetry_Port interface and SHALL NOT import a telemetry vendor SDK.
6. WHEN the Composition_Root selects a Telemetry_Port implementation, THE Composition_Root SHALL emit one startup log entry naming the selected backend (or `no-op`) using the existing `[infra]`-style log convention.
7. WHERE a telemetry backend is requested but its required credentials are missing, THE Composition_Root SHALL construct No_Op_Telemetry, SHALL emit a warning naming the skipped backend, and SHALL continue startup without aborting.

### Requirement 2: Configuration read once via the existing pattern

**User Story:** As an operator, I want telemetry configuration read once at startup using the established config pattern, so that the API and worker share identical, predictable telemetry settings.

#### Acceptance Criteria

1. WHEN the API_Server process or the Worker process starts, THE server SHALL read every telemetry configuration value exactly one time during module initialization in `app/apps/server/src/config.ts`, before the process begins serving HTTP requests or processing queue jobs, using the existing `Number(process.env.X ?? default)` and `boolEnv` patterns, and SHALL expose each value as a property of the exported `config` object.
2. THE server SHALL read the Error_Monitor data source name from the `SENTRY_DSN` environment variable and SHALL expose it on the `config` object as the verbatim trimmed string value, or as an empty string when the variable is unset.
3. THE server SHALL read the Product_Analytics key from the `POSTHOG_KEY` environment variable and SHALL expose it on the `config` object as the verbatim trimmed string value, or as an empty string when the variable is unset.
4. IF a telemetry environment variable contains only whitespace, THEN THE server SHALL expose the corresponding `config` value as an empty string.
5. WHERE a telemetry configuration value on the `config` object is an empty string, THE server SHALL classify the corresponding telemetry backend as not configured.
6. WHILE a telemetry backend is classified as not configured, THE server SHALL skip initialization of that backend and SHALL emit no telemetry data to it.
7. WHEN both the API_Server process and the Worker process start from the same environment, THE server SHALL derive every telemetry value on the `config` object from the same `config.ts` initialization, producing byte-for-byte identical effective telemetry values in both processes.

### Requirement 3: Offline-first degrade-and-warn, never blocking

**User Story:** As a developer working with zero API keys, I want telemetry to degrade to a no-op without blocking startup or the pipeline, so that the offline-first path runs exactly as it does today.

#### Acceptance Criteria

1. WHERE both `SENTRY_DSN` and `POSTHOG_KEY` are unset (undefined or empty string), THE server SHALL select No_Op_Telemetry and SHALL start the API_Server and the Worker without calling `process.exit`, without throwing, reaching `app.listen` on `config.port`.
2. WHEN No_Op_Telemetry is selected because telemetry configuration is absent, THE server SHALL emit exactly one warning log entry naming each absent telemetry configuration variable, mirroring the degrade-and-warn access-control pattern in `index.ts`, and SHALL continue startup.
3. THE telemetry configuration SHALL NOT be added to `missingRequiredConfig`, so that absent telemetry configuration never blocks startup in any mode.
4. WHEN No_Op_Telemetry handles any emit or capture call, THE No_Op_Telemetry SHALL perform zero outbound network connections to a telemetry endpoint and SHALL return without throwing (offline no-op property, verified by a fast-check property test of at least 100 runs).
5. IF an active Telemetry_Port implementation throws synchronously or rejects a promise while emitting or capturing, THEN THE Telemetry_Port SHALL contain the error and SHALL NOT propagate it into the Pipeline, the HTTP request path, or process startup (fail-open for telemetry).
6. WHERE exactly one of `SENTRY_DSN` and `POSTHOG_KEY` is set, THE server SHALL activate only the configured backend, SHALL degrade the unconfigured backend to a no-op, and SHALL emit a warning naming the absent variable.
7. WHERE Offline_Mode is in effect, THE Pipeline SHALL produce a report byte-identical in every claim, citation, audit, status, and reason field to the report it produces with telemetry absent.

### Requirement 4: Error and pipeline-failure capture with debugging context

**User Story:** As an operator debugging failures, I want unhandled errors and pipeline failures captured with structured context (stage, report id, provider), so that I can diagnose a failure without re-running it and without reading analyzed content.

#### Acceptance Criteria

1. WHEN the API_Server's Express error handler receives an error, THE API_Server SHALL capture that error through the Error_Monitor exactly once, in addition to the existing `console.error` logging.
2. IF the Worker's `handleJob` catches a Pipeline failure, THEN THE Worker SHALL capture that failure through the Error_Monitor exactly once with structured context fields identifying the report id and the failing Stage, in addition to the existing `failed`-status persistence.
3. WHEN an error is captured, THE Error_Monitor payload SHALL include the report id, the Stage name, and the active provider category (one of `llm`, `evidence`, `perspective`, `transcript`) as individually named, structured context fields.
4. THE Error_Monitor payload SHALL NOT include any Denied_Field value.
5. IF a Pipeline failure is captured, THEN THE capture SHALL NOT change the report's resulting `status`, `error` message, or persistence behavior relative to the current `handleJob` flow.
6. WHEN the Error_Monitor is No_Op_Telemetry, THE error-handling paths in the API_Server and the Worker SHALL perform zero outbound network connections to a telemetry endpoint and SHALL return without throwing, behaving identically to today.
7. WHERE the report id, the Stage name, or the active provider category cannot be determined for a captured error, THE Error_Monitor SHALL set that context field to an explicit `unknown` value rather than omitting the field, and the substituted value SHALL NOT be a Denied_Field value.
8. IF the API_Server captures an error through the Error_Monitor, THEN THE API_Server SHALL return to the client the identical HTTP status code and response body it returns today, unchanged by the capture.

### Requirement 5: PII and secret redaction at the telemetry trust boundary

**User Story:** As a steward of the trust boundary, I want every telemetry payload sanitized before emission, so that transcripts, raw claim text, JWTs, API keys, and user identifiers can never leak into telemetry.

#### Acceptance Criteria

1. THE Redactor SHALL be a pure function that accepts a candidate telemetry payload and returns a sanitized payload, without mutating its input and without reading or writing external state.
2. FOR ALL candidate payloads, THE sanitized payload returned by the Redactor SHALL contain no Denied_Field key and no value equal to a supplied Denied_Field value at every depth of nested objects and arrays (no-denied-field property, verified by a fast-check property test of at least 100 runs).
3. FOR ALL candidate payloads, applying the Redactor to an already-sanitized payload SHALL return a payload deeply equal to that already-sanitized payload (redaction idempotence property, verified by a fast-check property test of at least 100 runs).
4. WHEN the Telemetry_Port emits a Telemetry_Event or an Error_Monitor payload, THE Telemetry_Port SHALL pass that payload through the Redactor before emission.
5. FOR ALL candidate payloads, THE Redactor SHALL preserve every non-denied field with its key and value unchanged, including report ids, content ids, hashes, Stage names, provider categories, counts, durations, and Evidence_Outcome labels (field-preservation property, verified by a fast-check property test of at least 100 runs).
6. FOR ALL inputs including null, undefined, primitives, arrays, nested objects, and cyclic references, THE Redactor SHALL return a sanitized payload without throwing (totality property, verified by a fast-check property test of at least 100 runs).
7. IF the Redactor output still contains a Denied_Field, THEN THE Telemetry_Port SHALL suppress emission of that payload and SHALL record a redaction-failure indication.

### Requirement 6: Neutrality — no creator or truth verdict in any event

**User Story:** As the keeper of the Compass, I want a neutrality check asserting that no telemetry event carries a creator-reliability or content-truth verdict, so that "lens, not a judge" holds at the telemetry boundary as it does everywhere else.

#### Acceptance Criteria

1. THE Telemetry_Event property bag SHALL NOT contain any property key or property value expressing a reliability, credibility, or trust rating attached to a content creator, author, person, or channel.
2. THE Telemetry_Event property bag SHALL NOT contain any property key or property value expressing a truthfulness or accuracy verdict about analyzed content.
3. WHERE a source tier appears in a Telemetry_Event, THE source tier SHALL describe a source or citation only and SHALL NOT be keyed by, attributed to, or otherwise associated with a content creator, author, person, or channel.
4. THE Neutrality_Guard SHALL be a pure, total function over a candidate Telemetry_Event payload that returns a pass result when neither a creator-reliability dimension nor a content-truth verdict is present and returns a fail result otherwise (neutrality property, verified by a fast-check property test of at least 100 runs).
5. WHEN a Telemetry_Event identifies the analyzed content, THE Telemetry_Event SHALL reference it by report id, content id, or content hash only and SHALL NOT include a creator or channel identity.
6. IF the Neutrality_Guard returns a fail result for a candidate Telemetry_Event, THEN THE Telemetry_Port SHALL withhold that Telemetry_Event from Product_Analytics and SHALL emit zero outbound payload carrying the offending field.
7. FOR ALL candidate Telemetry_Event payloads, THE Neutrality_Guard SHALL return a pass-or-fail result without throwing for any input (totality property, verified by a fast-check property test of at least 100 runs).

### Requirement 7: Citation-coverage KPI derivation

**User Story:** As an operator measuring the first red-line trust KPI, I want Citation_Coverage derived from a report's verified claims, so that the share of claims reaching a cited outcome versus an honest-none outcome is measurable per report.

#### Acceptance Criteria

1. THE KPI_Deriver SHALL compute Citation_Coverage as a pure, total, deterministic function of a report's verified Claims and their Evidence_Outcomes, producing identical output for identical input and requiring no external service call.
2. THE KPI_Deriver SHALL classify each Claim's Evidence_Outcome into exactly one of two mutually exclusive groups: a Cited_Outcome (`matched_fact_check`, `matched_primary_source`, `matched_institutional_source`) or an Honest_None_Outcome (`relevant_context_only`, `no_sufficient_evidence`, `not_fact_checkable`).
3. WHEN a report contains at least one verified Claim, THE KPI_Deriver SHALL compute Citation_Coverage as the count of Claims with a Cited_Outcome divided by the total count of verified Claims, where Honest_None_Outcome Claims count toward the denominator but never the numerator.
4. WHEN a report contains zero verified Claims, THE KPI_Deriver SHALL report Citation_Coverage as exactly 0, treated as a valid honest-none outcome rather than a failure.
5. THE computed Citation_Coverage SHALL be a finite real number within the inclusive range 0 to 1 (bounded-and-total property, verified by a fast-check property test of at least 100 runs).
6. THE KPI_Deriver SHALL derive Citation_Coverage from the existing per-Claim `evidenceStrength` / audit `evidenceOutcome` data.
7. THE KPI_Deriver SHALL NOT recompute or alter any Evidence_Outcome.
8. IF a Claim carries an Evidence_Outcome outside the six defined values, THEN THE KPI_Deriver SHALL exclude that Claim from the Citation_Coverage numerator and SHALL leave the source report data unchanged.

### Requirement 8: Model-vs-human agreement KPI inputs

**User Story:** As an operator measuring the second red-line trust KPI, I want model Evidence_Outcomes compared against recorded human signals, so that model-vs-human agreement can be tracked as expert reviews, flags, and disputes accumulate.

#### Acceptance Criteria

1. THE KPI_Deriver SHALL compute Model_Human_Agreement inputs as a pure, total, deterministic function of a report's model-produced Evidence_Outcomes and the Human_Signals recorded for that report, producing identical output for identical inputs.
2. THE KPI_Deriver SHALL treat exactly three kinds of Human_Signal — an expert review status (`provenance.reviewStatus`), a flag (`createFlag`), and a dispute (`createDispute`) — as the signals compared against the model Evidence_Outcomes.
3. WHEN a Human_Signal and a model Evidence_Outcome share the same report id and claim id, THE KPI_Deriver SHALL pair them and SHALL classify the pair as agreeing or disagreeing according to whether the Human_Signal concurs with the model Evidence_Outcome.
4. IF a report has zero recorded Human_Signals, THEN THE KPI_Deriver SHALL report Model_Human_Agreement as undefined-for-lack-of-signal rather than as agreement or disagreement.
5. WHILE a report has at least one paired Human_Signal, THE KPI_Deriver SHALL express Model_Human_Agreement as a finite real number within the inclusive range 0 to 1, computed as the count of agreeing pairs divided by the total count of compared pairs.
6. IF a report has recorded Human_Signals but none shares a report id and claim id with any model Evidence_Outcome, THEN THE KPI_Deriver SHALL report Model_Human_Agreement as undefined-for-lack-of-signal.
7. THE KPI_Deriver SHALL NOT read, store, or emit the disputing or flagging user's identity, referencing disputes and flags by report id and claim id only.
8. THE KPI_Deriver SHALL NOT attach any agreement or disagreement result to a content creator, author, person, or channel.

### Requirement 9: Operator product metrics

**User Story:** As an operator running the lens, I want analysis throughput, cache hit/miss rate, latency, evidence-outcome distribution, and dispute/flag rates visible in product analytics, so that I can monitor system health and the KPIs ahead of pilots.

#### Acceptance Criteria

1. WHEN the API_Server resolves an analysis submission from cache, THE Telemetry_Port SHALL emit a Telemetry_Event recording the submission identifier and the categorical label `cache_hit`, and WHEN the API_Server queues a new analysis, THE Telemetry_Port SHALL emit a Telemetry_Event recording the submission identifier and the categorical label `cache_miss`.
2. WHEN the Worker completes a Pipeline run, THE Telemetry_Port SHALL emit a Telemetry_Event recording the report id, the resulting `status` as a categorical label, and the end-to-end Pipeline duration as a non-negative integer count of milliseconds.
3. WHEN the Worker completes a Pipeline run, THE Telemetry_Port SHALL emit the report's Evidence_Outcome distribution as one non-negative integer count per defined Evidence_Outcome category and the report's Citation_Coverage value as a ratio between 0.0 and 1.0 inclusive.
4. WHEN a dispute is created or a flag is created, THE Telemetry_Port SHALL emit a Telemetry_Event recording the report id and the event category as the categorical label `dispute` or `flag`.
5. THE operator-facing Telemetry_Events SHALL carry only identifiers, categorical labels, non-negative integer counts, and non-negative durations expressed in milliseconds, and SHALL contain no Denied_Field value.
6. WHILE the Telemetry_Port is No_Op_Telemetry, WHEN a metric-emitting call site is invoked, THE Telemetry_Port SHALL return without raising an error and SHALL emit zero outbound events.
7. IF emitting any operator-facing Telemetry_Event fails, THEN THE Telemetry_Port SHALL NOT propagate the failure to the calling API_Server or Worker operation, and the in-progress cache resolution, Pipeline run, dispute creation, or flag creation SHALL complete unaffected.

### Requirement 10: Dual-process initialization without drift

**User Story:** As an operator running the API and worker as separate processes, I want telemetry initialized correctly in both from the shared composition root, so that the two processes never drift in telemetry configuration or behavior.

#### Acceptance Criteria

1. WHEN the API_Server process starts, THE API_Server SHALL obtain its Telemetry_Port exclusively through the shared Composition_Root (`buildContext`) and through no other construction path.
2. WHEN the Worker process starts, THE Worker SHALL obtain its Telemetry_Port exclusively through the same shared Composition_Root (`buildContext`) and through no other construction path.
3. WHEN the API_Server and the Worker start from identical environment variables (`SENTRY_DSN`, `POSTHOG_KEY`), THE Composition_Root SHALL resolve the identical Telemetry_Port implementation selection (active backend or No_Op_Telemetry) and equal effective configuration values in both processes, consistent with the existing single-read sharing of `config.concurrencyCap`.
4. WHERE telemetry is configured, THE API_Server SHALL initialize the Telemetry_Port before it begins accepting HTTP requests.
5. IF telemetry initialization fails in either process, THEN that process SHALL log a warning indicating telemetry initialization failure, SHALL continue startup using No_Op_Telemetry rather than aborting, and the failure in one process SHALL NOT affect telemetry in the other process.
6. WHERE telemetry is configured, THE Worker SHALL initialize the Telemetry_Port before it begins processing queue jobs.

### Requirement 11: Invariant gate and pipeline behavior preserved

**User Story:** As a steward of the codified moat, I want observability to leave the invariant gate and pipeline outputs untouched, so that the moat is only ever observed and verified, never weakened.

#### Acceptance Criteria

1. THE feature SHALL NOT modify `app/apps/server/src/core/assemble.ts`.
2. WHEN a report is produced from identical content under configurations differing only in active versus No_Op_Telemetry, THE report `status`, `reasons`, claims, citations, and audits SHALL be field-by-field equal across the two configurations.
3. THE feature SHALL NOT change which Claims, citations, audits, or context reach the Invariant_Gate, altering only what is observed about them.
4. WHERE a Claim resolves to an Honest_None_Outcome (`relevant_context_only`, `no_sufficient_evidence`, or `not_fact_checkable`), THE telemetry derivation SHALL record it as an honest no-evidence outcome and SHALL NOT record it as a failure, an error, or a verdict of reduced quality.
5. THE Invariant_Gate decision SHALL NOT await or block on any telemetry call.
6. WHERE telemetry is emitted on the Invariant_Gate path, THE emission SHALL be bounded to a best-effort attempt of at most 50 milliseconds, after which it SHALL be abandoned.
7. IF a telemetry call on the gate path errors, times out, or throws, THEN THE Pipeline SHALL still produce a report identical to the report produced with telemetry absent.

### Requirement 12: Web-side analytics with neutrality, PII, and consent

**User Story:** As a product owner of the web app, I want page/report views and dispute/flag/share interactions captured in the web client under the same neutrality and PII rules, so that web analytics respects the Compass and the user's consent.

#### Acceptance Criteria

1. WHEN a user opens a report view or navigates to a hash route in `apps/web`, THE Web_Analytics SHALL emit exactly one Telemetry_Event identifying the view by route and report id only.
2. WHEN a user submits a dispute, submits a flag, or shares a report in `apps/web`, THE Web_Analytics SHALL emit a Telemetry_Event recording the interaction category (`dispute`, `flag`, or `share`) and the report id.
3. THE Web_Analytics Telemetry_Events SHALL NOT include raw claim text, transcript text, JWTs, or any user identifier, and SHALL NOT attach any reliability dimension to a creator or channel.
4. WHERE the Product_Analytics key (`VITE_POSTHOG_KEY`) is unset, THE Web_Analytics SHALL degrade to a no-op, returning within the same synchronous execution tick, emitting zero outbound events, and never blocking rendering.
5. WHILE analytics consent has not been granted, THE Web_Analytics SHALL emit zero outbound Telemetry_Events.
6. WHEN analytics consent is granted, THE Web_Analytics SHALL begin emitting Telemetry_Events for views and interactions occurring after the grant.
7. IF an outbound Web_Analytics event fails, THEN THE Web_Analytics SHALL discard the failure silently without affecting rendering, routing, or accessibility.
8. THE web app SHALL present an identical rendered DOM, identical hash-route navigation, and an identical accessibility tree (ARIA roles/labels, focus order, keyboard operability) regardless of whether Web_Analytics is active or a no-op.

### Requirement 13: Property-based and offline test coverage

**User Story:** As a maintainer, I want the pure telemetry logic covered by property tests under the existing harness, so that redaction, neutrality, KPI derivation, and the offline no-op are verified by construction.

#### Acceptance Criteria

1. WHEN the server property test suite is executed, THE feature's server property tests SHALL run under `node:test` with `node:assert` and `fast-check` configured to a minimum of 100 runs per property, and SHALL complete with zero failing assertions.
2. THE feature SHALL register every server property test file in the explicit server test file list in `app/apps/server/package.json`.
3. WHEN the web property test suite is executed, THE feature's web property tests SHALL run under Vitest with `fast-check` configured to a minimum of 100 runs per property, and SHALL complete with zero failing assertions.
4. EACH property test SHALL carry a leading comment of the form `// Feature: observability-instrumentation, Property <n>: <description>` immediately followed by a `Validates: Requirements <ids>` reference naming at least one requirement id.
5. THE feature SHALL include property tests covering each of: redaction never emitting a Denied_Field (Req 5.2), redaction idempotence (Req 5.3), Redactor totality (Req 5.6), neutrality of Telemetry_Events (Req 6.4), Citation_Coverage bounded-and-total (Req 7.5), and the offline no-op emitting zero outbound events (Req 3.4).
6. WHERE a telemetry logic unit contains branching, data transformation, or value derivation beyond a single direct assignment, THE feature SHALL leave at least one runnable assertion-based check for that unit, consistent with the repository's existing self-check convention.
