# Implementation Plan: parallel-evidence-lookups

## Overview

Parallelize Stage 3 evidence lookups (the claim loop in `pipeline/stages.ts` and the
Query_Variant loop in `router/index.ts`) under **one shared counting semaphore per report**
(`src/concurrency.ts`), bounded by a configurable `concurrencyCap` (default 4, `[1,32]`).
Determinism is preserved by writing results into pre-sized arrays at their original index and
flattening in index order; error isolation reproduces the existing serial defaults exactly; and
the invariant gate (`core/assemble.ts`) and `makeRetrieve` are **strictly verify-only — never
edited**. Implementation is TypeScript (the design uses TypeScript; no new dependency —
`fast-check` is already a devDependency). Each task builds on the prior ones and ends with the
suite wired and green.

## Tasks

- [x] 1. Bounded-concurrency foundation
  - [x] 1.1 Add the `Semaphore` helper in `src/concurrency.ts`
    - New file: counting semaphore with FIFO waiter queue; `constructor(cap)` floors to `Math.max(1, floor(cap))`; private `acquire()`/`release()` (release hands the freed slot straight to the head waiter, else returns it to the pool); public `async run<T>(task)` that acquires, runs, and releases in `finally` (frees the slot even on throw).
    - Leave one runnable assert-based self-check at the bottom (runnable via `node --import tsx src/concurrency.ts`, matching the `index.ts`/`runner.ts` convention): `cap=1` serializes (max in-flight 1), `cap=2` lets two overlap, and `run` releases its slot when the task throws.
    - _Requirements: 1.3, 2.5, 4.6, 5.1, 5.4_

  - [x] 1.2 Add `resolveConcurrencyCap` + `config.concurrencyCap` in `src/config.ts`
    - Add pure `resolveConcurrencyCap(raw: string | undefined): { value: number; warning?: string }` mirroring the existing `Number(process.env.X ?? default)` / `missingRequiredConfig` patterns: valid = an integer in inclusive `[1,32]`; absent, empty, non-numeric, non-integer, `<1`, or `>32` falls back to `CONCURRENCY_CAP_DEFAULT = 4` (reject to default, do NOT clamp) and returns a warning naming `CONCURRENCY_CAP`.
    - Read `process.env.CONCURRENCY_CAP` once, `console.warn` the warning if present (warn-and-default, never abort startup), and expose `concurrencyCap` on the exported `config` object so both API and worker processes read the identical value from the single module.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6_

  - [x] 1.3 Write property test for the concurrency-cap resolver (extend `test/config.test.ts`)
    - **Property 8: Concurrency-cap resolution**
    - **Validates: Requirements 2.2, 2.3, 2.4**
    - fast-check, ≥100 runs, `node:test` + `node:assert`: across all invalid classes (absent/empty/non-numeric/non-integer/`<1`/`>32`) assert default `4` + warning naming `CONCURRENCY_CAP`; for integers in `[1,32]` assert the value passes through with no warning. Carry the `// Feature: parallel-evidence-lookups, Property 8: ...` + `Validates:` comment. (Already in the `package.json` test list — no wiring change.)

- [x] 2. Parallelize evidence lookups under the shared semaphore
  - [x] 2.1 Parallelize the Query_Variant loop in `src/router/index.ts`
    - Add `semaphore?: Semaphore` to `VerifyDeps` (absent ⇒ standalone `new Semaphore(1)` for back-compat). Replace the serial Stage-4 variant `for` loop with an index-preserving `Promise.all` over `queryPack`: pre-size `perVariant[j]`, write `perVariant[j] = await sem.run(() => deps.retrieve(variant))`, wrap each in `try/catch` setting `perVariant[j] = []` on failure, then `candidates = perVariant.flat()` (variant-index order, then in-variant order).
    - Keep `makeRetrieve` and `retrievalRank` **untouched** (verify-only): `retrievalRank` stays assigned from in-variant position inside `makeRetrieve`, preserving `DEFAULT_PER_VARIANT_CAP`. `normalize`/`triage` run before and outside the semaphore so a `not_fact_checkable` claim short-circuits with zero acquisitions. Everything downstream (validate → route → outcome → assemble) is unchanged.
    - _Requirements: 1.2, 1.6, 3.4, 3.5, 4.2, 4.3, 4.4, 5.3_

  - [x] 2.2 Parallelize the claim loop in `src/pipeline/stages.ts`
    - Add a `concurrencyCap = 1` parameter to `runPipeline` (default keeps every existing caller behaviorally identical to the serial baseline). Create one shared `new Semaphore(concurrencyCap)`, thread it into `verifyDeps.semaphore`, and replace the serial claim `for` loop with an index-preserving `Promise.all` over `extraction.claims`: pre-size `claims[i]`, `audits[i]`, `perClaimUseful[i]`, `perClaimCards[i]`; write each by extraction index `i`; then `.flat()` each in index order.
    - Leave the invariant gate `core/assemble.ts` **strictly verify-only — do not edit it**; `assembleReport`, framing, and perspectives stay unchanged. Output is a pure function of input + providers except the pre-existing non-deterministic `randomUUID()` claim ids.
    - _Requirements: 1.1, 1.4, 3.1, 3.2, 3.3, 4.1, 4.5, 6.5_

  - [x] 2.3 Wire `config.concurrencyCap` into `src/worker.ts`
    - Pass `config.concurrencyCap` as the `concurrencyCap` argument to the `runPipeline` call in the worker. The API process shares the same value via the single config module (no separate read). Keep the existing `assertInvariantGateIntact` boot guard in place (verify-only).
    - _Requirements: 2.1, 2.6, 8.1_

  - [x] 2.4 Write property test `test/router/parallel.equivalence.test.ts`
    - **Property 1: Output-equivalence (parallel ≡ serial)**
    - **Validates: Requirements 1.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.2, 6.4, 6.5, 6.6, 8.2**
    - fast-check ≥100 runs over random extractions + deterministic mock providers (offline, in-memory): `deepEqual(report(cap=1), report(cap=N))` for `N ∈ 2..8`, excluding only the per-claim `randomUUID` ids. Carry the `// Feature/Property/Validates` comment.

  - [x] 2.5 Write property test `test/router/parallel.isolation.test.ts`
    - **Property 2: Error isolation reproduces serial defaults**
    - **Validates: Requirements 1.5, 4.1, 4.2, 4.3, 4.4, 4.5**
    - fast-check ≥100 runs: inject random variant/claim `retrieve` throws; assert `deepEqual` to `cap=1` with the same injected failures; degenerate all-variants-fail claim resolves to `no_sufficient_evidence` with zero citations. Offline mock substrate; carry the comment.

  - [x] 2.6 Write property test `test/router/parallel.cap.test.ts`
    - **Property 3: In-flight submissions never exceed the cap**
    - **Validates: Requirements 1.3, 2.5, 5.1**
    - fast-check ≥100 runs: instrument `retrieve` to increment on entry / decrement on exit; assert max observed in-flight ≤ `N` over random reports/caps, and exactly `1` when `N = 1`. Offline mock substrate; carry the comment.

  - [x] 2.7 Write property test `test/router/parallel.cost.test.ts`
    - **Property 4: Cost-neutral and complete (no dropped, starved, or extra calls)**
    - **Validates: Requirements 4.6, 5.2, 5.3, 5.4, 5.5**
    - fast-check ≥100 runs with a counting provider: assert `calls(cap=1) === calls(cap=N)` including `not_fact_checkable` claims (zero calls on both paths) and under injected failures (no extra retry calls). Offline mock substrate; carry the comment.

  - [x] 2.8 Write property test `test/router/parallel.honestNone.test.ts`
    - **Property 5: Honest-none preserved**
    - **Validates: Requirements 6.3, 8.3**
    - fast-check ≥100 runs: claims engineered to resolve to the Honest_None_State; assert `evidenceStrength === 'none'` with zero citations reaching the gate, equal to the serial path. Offline mock substrate; carry the comment.

  - [x] 2.9 Write property test `test/router/parallel.latency.test.ts`
    - **Property 6: Latency reduction under bounded parallelism**
    - **Validates: Requirements 1.1, 1.2, 7.2**
    - fast-check ≥100 runs (few claims, generous fixed per-lookup delay e.g. 40–50 ms so the serial total dwarfs the parallel total): for ≥2 independent claims and `1 < N ≤ claimCount`, assert `elapsed(cap=N) < elapsed(cap=1)` (strict-less) and observe max in-flight > 1. Offline mock substrate; carry the comment. (ponytail ceiling: wall-clock can flake on a pathologically loaded box; upgrade path is a fake-timer harness.)

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Benchmark p95 reporting
  - [x] 4.1 Add `percentile` + `runLatencyBenchmark` + `LatencyBenchmarkReport` to `src/router/benchmark/runner.ts`
    - Add a pure nearest-rank `percentile(sortedAscMs, p)` helper; a `LatencyBenchmarkReport` type (`latenciesMs`, `p95Ms`, `thresholdMs`, `passed`); and `runLatencyBenchmark(runOnce, { runs, thresholdMs = 30_000, now = performance.now })` that runs `runOnce` `runs` (≥20) times, times each with the injected clock, sorts, computes `p95Ms`, and sets `passed = p95Ms <= thresholdMs`. A run whose lookups fail still completes and contributes its latency (`runOnce` is the whole pipeline; `verifyClaim` is total). Leave the existing FER machinery untouched and add a runnable assert-based self-check matching the file's convention.
    - _Requirements: 7.1, 7.3, 7.4_

  - [x] 4.2 Write property test `test/router/benchmark.p95.test.ts`
    - **Property 7: p95 latency reporting is correct**
    - **Validates: Requirements 7.3**
    - fast-check ≥100 runs over random non-empty latency samples + thresholds (injected clock, deterministic): assert the report exposes the per-run latencies, the nearest-rank p95 computed from them, and `passed === (p95 <= threshold)`. Carry the `// Feature/Property/Validates` comment.

- [x] 5. Wire the test suite and verify green
  - [x] 5.1 Confirm test wiring and run the gates in `app/apps/server`
    - The seven `test/router/parallel.*` and `test/router/benchmark.p95` files are auto-included by the existing `"test/router/**/*.test.ts"` glob, and the extended `test/config.test.ts` is already in the `test` list — add by name to the explicit `test` list in `app/apps/server/package.json` only any new test file that falls outside the glob. Then run `npm test` and `npm run typecheck` in `app/apps/server` and confirm both are green (zero failing assertions, no type errors).
    - _Requirements: 8.4_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-test sub-tasks (the runnable PBT checks); they can be skipped for a faster MVP but each is required for the Req 8.4 verification gate. All carry the `// Feature: parallel-evidence-lookups, Property <n>: ...` + `Validates: Requirements …` comment and run offline (mock providers + in-memory infra, ≥100 runs, `node:test` + `node:assert` + `fast-check`).
- `core/assemble.ts` (invariant gate) and `makeRetrieve` / `DEFAULT_PER_VARIANT_CAP` are **verify-only** — never edited (Req 1.6, 6.1).
- The `Serial_Baseline` reference is `runPipeline(..., cap = 1)`; equivalence tests compare `cap=1` against random `cap=N > 1`.
- The Req 7.1 offline 20-run cache-miss benchmark execution is an ops/integration step, not a coding task; this plan delivers `runLatencyBenchmark` and its `passed` ship-gate verdict only.
- No new dependency is added (`fast-check` is already a devDependency); no new abstraction beyond the ~30-LOC `Semaphore`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "4.1"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3"] },
    { "id": 4, "tasks": ["2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "4.2"] },
    { "id": 5, "tasks": ["5.1"] }
  ]
}
```
