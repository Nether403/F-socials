# Requirements Document

## Introduction

Stage 3 of the analysis pipeline (`app/apps/server/src/pipeline/stages.ts`) verifies each extracted claim through the Claim_Verification_Router in a **serial** `for` loop — one `await verifyClaim(...)` at a time. Inside the router (`src/router/index.ts`), each claim's Query_Pack (≤6 Query_Variants) is also submitted to the Provider_Chain **sequentially**, one variant at a time. Only the lowest level, candidate collection across providers for a single variant (`src/router/retrieve.ts` `makeRetrieve`), runs concurrently via `Promise.all`, bounded by `DEFAULT_PER_VARIANT_CAP`.

The router migration raised the per-claim API-call count (up to 6 variants × providers per claim), so the serial structure now dominates cache-miss latency. The roadmap (§4 P1, "Parallelize evidence lookups") sets the ship gate at **p95 ≤ 30s on cache miss** and prescribes a `Promise.all` with a **concurrency cap** across claims and/or variants — a cap, not naive fan-out, because real providers (Gemini, Tavily, GDELT, Google Fact Check) cost money per call and enforce rate limits, so unbounded concurrency is both a cost and a rate-limit hazard.

This feature parallelizes evidence lookups under a bounded, configurable concurrency cap while preserving three things exactly: the **deterministic output ordering** (claims in extraction order, audits and context aligned per claim, candidates in Query_Pack order) the current serial code provides; **error isolation**, so one failing claim or variant never corrupts the rest of the report; and the **invariant gate** in `core/assemble.ts`, which this work satisfies by construction and only ever verifies, never weakens. The parallel path must remain functional in the offline, zero-API-key configuration (mock providers + in-memory infra).

This is a backend latency/concurrency change. It must not alter *which* claims, citations, audits, or context reach the gate — only the timing with which they are produced.

## Glossary

- **Pipeline**: The `runPipeline` analysis flow in `app/apps/server/src/pipeline/stages.ts` (transcript → extract → verify claims → perspectives → assemble/gate).
- **Verification_Stage**: Stage 3 of the Pipeline — the loop over `extraction.claims` that calls `verifyClaim` for each Claim and collects `claims`, `audits`, `usefulContext`, and router `contextCards`.
- **Claim_Verification_Router**: The `verifyClaim` orchestration in `app/apps/server/src/router/index.ts` (normalize → triage → query pack → retrieve → validate → assemble outcome).
- **Query_Pack**: The ordered list of up to six Query_Variants generated from a Claim's Canonical_Claim (`src/router/queryPack.ts`).
- **Query_Variant**: A single search query submitted to retrieval for a Claim.
- **Provider_Chain**: The external evidence providers (mock, Google Fact Check, GDELT, Tavily, or the chained provider) invoked during retrieval; real providers cost money per call and are rate-limited.
- **Retrieve**: The per-variant candidate-collection function built by `makeRetrieve` (`src/router/retrieve.ts`), which already queries all providers for one Query_Variant concurrently under `DEFAULT_PER_VARIANT_CAP`.
- **Concurrency_Cap**: The configurable maximum number of evidence lookups (claims and/or Query_Variants) that may be in flight at the same time.
- **Bounded_Scheduler**: The mechanism that runs evidence lookups in parallel while ensuring the number of in-flight lookups never exceeds the Concurrency_Cap.
- **Serial_Baseline**: The current sequential behavior of the Verification_Stage and the router's Query_Variant loop, used as the reference for output equivalence.
- **Invariant_Gate**: The report-readiness gate in `app/apps/server/src/core/assemble.ts`.
- **Honest_None_State**: A Claim with `evidenceStrength` equal to `none` and zero citations — a valid, honest outcome that must reach the gate intact.
- **Cache_Miss**: An analysis run in which no cached report or cached retrieval result is available, so every required evidence lookup is performed against the Provider_Chain.
- **Benchmark_Runner**: The existing latency/quality harness at `app/apps/server/src/router/benchmark/runner.ts` with fixtures at `benchmark/fixtures.json`.

## Requirements

### Requirement 1: Bounded-concurrency parallelization of evidence lookups

**User Story:** As an operator serving cache-miss analyses, I want evidence lookups to run in parallel under a bounded scheduler, so that per-claim and per-variant API calls overlap instead of waiting in series.

#### Acceptance Criteria

1. WHEN the Verification_Stage processes a report with two or more extracted Claims and the Concurrency_Cap is two or more, THE Bounded_Scheduler SHALL execute the Claims' evidence lookups such that at least two lookups have overlapping execution intervals (a later lookup begins before a prior lookup completes).
2. WHILE the count of in-flight Provider_Chain submissions is below the Concurrency_Cap and at least one scheduled evidence lookup has not yet started, THE Bounded_Scheduler SHALL start an additional evidence lookup, selected across Claims, across Query_Variants, or both.
3. THE Concurrency_Cap SHALL be a configurable positive integer of at least 1, and WHILE evidence lookups are executing, THE Bounded_Scheduler SHALL keep the number of in-flight Provider_Chain submissions at or below the Concurrency_Cap at every point in time.
4. WHEN every scheduled evidence lookup for a report has settled (each lookup having either resolved or been rejected), THE Verification_Stage SHALL produce the identical set and ordering of Claims, audits, useful-context candidates, and router context cards that the Serial_Baseline produces for the identical input.
5. IF one or more evidence lookups reject or exceed their existing timeout, THEN THE Bounded_Scheduler SHALL continue executing and settling the remaining scheduled lookups without aborting the unaffected lookups, and SHALL yield for each affected Claim and Query_Variant the same result the Serial_Baseline yields for the identical failure.
6. THE Bounded_Scheduler SHALL preserve the existing per-variant provider concurrency in `makeRetrieve` and SHALL NOT remove the `DEFAULT_PER_VARIANT_CAP` bound on candidates kept per Query_Variant.

### Requirement 2: Configurable concurrency cap

**User Story:** As an operator tuning cost and rate-limit headroom, I want the concurrency cap to be configurable, so that I can adjust parallelism per environment without code changes.

#### Acceptance Criteria

1. WHEN the API process or the worker process starts, THE server SHALL read the Concurrency_Cap once from its environment variable using the same `Number(process.env.X ?? default)` configuration pattern used in `app/apps/server/src/config.ts`.
2. WHERE no Concurrency_Cap environment variable is set, THE server SHALL apply a documented default Concurrency_Cap of 4, which is a finite integer within the inclusive range 1 to 32.
3. IF the configured Concurrency_Cap is absent, non-numeric, not an integer, less than 1, or greater than 32, THEN THE server SHALL apply the documented default Concurrency_Cap of 4.
4. WHEN the server falls back to the default Concurrency_Cap because the configured value is invalid, THE server SHALL emit a warning log entry naming the Concurrency_Cap configuration variable and SHALL continue startup without aborting.
5. WHERE the effective Concurrency_Cap equals 1, THE Bounded_Scheduler SHALL execute evidence lookups one at a time, with no two lookups in flight concurrently, reproducing the Serial_Baseline behavior.
6. THE server SHALL apply the identical effective Concurrency_Cap value in both the API process and the worker process.

### Requirement 3: Deterministic output ordering

**User Story:** As a maintainer relying on reproducible reports, I want parallelization to preserve the deterministic ordering the serial code guarantees, so that report content and audits do not depend on which lookup finishes first.

#### Acceptance Criteria

1. WHEN the Verification_Stage assembles the report, THE Verification_Stage SHALL order the `claims` array so that each Claim occupies the same zero-based index it held in the source extraction order, regardless of the order in which evidence lookups complete.
2. WHEN the Verification_Stage assembles the report, THE Verification_Stage SHALL place each Claim's `audit` record at the same zero-based index as its corresponding Claim, such that for every position i the `audit` at index i describes the Claim at index i.
3. WHEN the Verification_Stage collects useful-context candidates and router context cards, THE Verification_Stage SHALL append them grouped by their originating Claim's zero-based extraction index in ascending order, and SHALL preserve each Claim's internal candidate and card order within its group, regardless of lookup completion order.
4. WHEN the Claim_Verification_Router collects candidates across Query_Variants, THE Claim_Verification_Router SHALL order the collected candidates first by the zero-based position of their originating Query_Variant in the Query_Pack (ascending) and then by each candidate's position within that Query_Variant's results (ascending), regardless of the order in which Query_Variant retrievals complete.
5. THE Claim_Verification_Router SHALL assign each candidate's `retrievalRank` from its zero-based position within its own Query_Variant's results only, such that two runs over identical input produce identical `retrievalRank` values independent of cross-lookup completion order.
6. FOR ALL inputs, THE report produced by the Bounded_Scheduler SHALL be deep-structurally equal to the report produced by the Serial_Baseline for the identical input — equal in claim order, citation content and order, audit content and order, useful-context order, and context-card order, where deep-structural equality means identical field values and identical array element ordering at every position (output-equivalence property, verified by a fast-check property test of at least 100 runs).

### Requirement 4: Error isolation across claims and variants

**User Story:** As an operator, I want one failing claim or variant to never corrupt the rest of a report, so that a single provider error degrades one lookup rather than the whole analysis.

#### Acceptance Criteria

1. IF the evidence lookup for one Claim throws or rejects, THEN THE Bounded_Scheduler SHALL produce an independent outcome for every other Claim in the report, and the failure SHALL NOT propagate to or alter the outcome of any other Claim.
2. IF the retrieval for one Query_Variant throws or rejects, THEN THE Claim_Verification_Router SHALL count exactly zero candidates from that Query_Variant.
3. WHEN a Query_Variant's retrieval has failed, THE Claim_Verification_Router SHALL continue processing each remaining Query_Variant in the Query_Pack.
4. IF every Query_Variant retrieval for a Claim fails, THEN THE Claim_Verification_Router SHALL resolve that Claim to a `no_sufficient_evidence` outcome with exactly zero citations.
5. WHEN one Claim's lookup fails and at least one other Claim's lookup succeeds, THE Verification_Stage SHALL keep each successful Claim at its original zero-based extraction position and SHALL NOT shift, drop, or reorder it due to the failure.
6. WHILE sibling evidence lookups are in flight, IF one lookup rejects, THEN THE Bounded_Scheduler SHALL allow each in-flight sibling lookup to run to its own completion or failure without cancellation or abortion.

### Requirement 5: Cost and rate-limit safety

**User Story:** As an operator paying per provider call, I want parallelization to bound concurrent external calls without adding new calls, so that overlap does not multiply cost or trip provider rate limits.

#### Acceptance Criteria

1. WHILE a report is being verified, THE Bounded_Scheduler SHALL keep the number of concurrent Provider_Chain submissions at or below the effective Concurrency_Cap (a finite positive integer per Requirement 2), counted as in-flight lookups for that report.
2. FOR ALL inputs, THE total number of Provider_Chain calls made by the Bounded_Scheduler for a report SHALL equal the total number made by the Serial_Baseline for the identical input (cost-neutral property, verified by a fast-check property test of at least 100 runs).
3. WHEN triage classifies a Claim as `not_fact_checkable`, THE Bounded_Scheduler SHALL resolve that Claim through the triage short-circuit and SHALL issue zero Provider_Chain calls for it, matching the Serial_Baseline.
4. WHEN the number of pending evidence lookups exceeds the effective Concurrency_Cap, THE Bounded_Scheduler SHALL queue the excess lookups, start each only as in-flight capacity becomes available, and eventually start every queued lookup so that no pending lookup is dropped or starved.
5. IF an evidence lookup for a Claim or Query_Variant fails or rejects, THEN THE Bounded_Scheduler SHALL NOT issue any Provider_Chain call beyond those the Serial_Baseline issues for the identical input, performing no additional retry calls attributable to parallelization.

### Requirement 6: Invariant gate and honest-none preserved

**User Story:** As a steward of the codified moat, I want parallelization to leave the invariant gate and the honest no-evidence state untouched, so that the moat is only ever verified, never weakened.

#### Acceptance Criteria

1. THE feature SHALL NOT modify `app/apps/server/src/core/assemble.ts`.
2. WHEN a report is produced through the Bounded_Scheduler, THE report `status` SHALL equal the `status` the Serial_Baseline produces for the identical input, and THE report `reasons` SHALL contain the same elements in the same order as the Serial_Baseline produces for the identical input.
3. WHERE a Claim resolves to the Honest_None_State, THE Verification_Stage SHALL deliver that Claim to the Invariant_Gate with `evidenceStrength` equal to `none` and zero citations, identically whether produced through the serial path or the parallel path.
4. THE Bounded_Scheduler SHALL NOT present any non-matching candidate as a citation.
5. THE Bounded_Scheduler SHALL preserve the router's separation of ledger citations from useful-context and context-card material.
6. THE set of Claims and citations reaching the Invariant_Gate through the Bounded_Scheduler SHALL be equal to the set reaching it through the Serial_Baseline for the identical input, differing at most in order and concurrency of production.

### Requirement 7: Cache-miss latency target

**User Story:** As an operator held to the ship gate, I want bounded parallelization to meet the p95 latency target on cache miss, so that the feature delivers its committed performance improvement.

#### Acceptance Criteria

1. WHEN a Cache_Miss analysis is executed at least 20 times over the complete Benchmark_Runner fixture set, with the evidence cache cleared before each run so every run resolves all evidence lookups from providers, THE Pipeline SHALL complete with a measured 95th-percentile end-to-end latency across those runs of at most 30 seconds (30,000 milliseconds).
2. WHEN evidence lookups for a report containing at least 2 independent Claims are executed with a Concurrency_Cap of N where N is greater than 1 and at most the number of independent Claims, using deterministic delayed mock providers configured with a fixed, identical per-lookup latency, THE Bounded_Scheduler SHALL complete the report in strictly less wall-clock time than the Serial_Baseline for the same input (latency-reduction property).
3. WHEN a Cache_Miss benchmark execution completes, THE Benchmark_Runner SHALL report the per-run end-to-end latencies, the aggregate measured cache-miss 95th-percentile latency, and a pass/fail result indicating whether the 95th-percentile latency is at most 30 seconds, so the ship gate can be verified.
4. IF an evidence lookup fails or exceeds its per-lookup timeout during a Cache_Miss run, THEN THE Bounded_Scheduler SHALL record the failed lookup and continue scheduling the remaining independent lookups so the run still completes and contributes its measured end-to-end latency to the 95th-percentile calculation.

### Requirement 8: Offline-first parallel path

**User Story:** As a developer working with zero API keys, I want the parallel path to work offline, so that the mock-provider, in-memory configuration stays fully functional and testable.

#### Acceptance Criteria

1. WHERE the composition root selects mock providers and in-memory infrastructure because zero API keys are configured, THE Bounded_Scheduler SHALL execute the parallel evidence-lookup path under the same effective Concurrency_Cap that applies with real providers.
2. WHEN the server runs with zero API keys, THE parallel path SHALL produce a report deep-structurally equal to the Serial_Baseline for the identical input across status, reasons, claim order, citation content and order, audit content and order, useful-context order, and context-card order (offline output-equivalence property, verified by a fast-check property test of at least 100 runs).
3. WHERE a Claim resolves to the Honest_None_State on the offline path, THE Verification_Stage SHALL deliver it to the Invariant_Gate with `evidenceStrength` equal to `none` and zero citations, identically to the Serial_Baseline.
4. THE feature's property tests SHALL run under `node:test` with `node:assert` and `fast-check` at a minimum of 100 runs, SHALL be added to the explicit server test file list in `app/apps/server/package.json`, and SHALL pass with zero failing assertions.
5. WHERE the parallel path runs offline, THE Bounded_Scheduler SHALL complete a report with no outbound network connection to an external Provider_Chain endpoint.
