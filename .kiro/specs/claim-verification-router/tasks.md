# Implementation Plan: Claim Verification Router

## Overview

This plan wraps a staged precision pipeline (normalize → triage → query pack → retrieve → validate → assemble outcome) around the **existing** `Provider_Chain`, inside the existing Worker and Pipeline. It introduces a new `src/router/` module, extends the type system and provider interfaces, adds a runtime invariant-gate guard, persists per-claim audit records, and builds an offline benchmark with a False_Evidence_Rate ship gate.

Language: **TypeScript** (matches the existing `app/apps/server` codebase). Property-based tests use **`fast-check`** integrated with the existing `node:test` runner (minimum 100 iterations per property). All paths are under `app/apps/server`.

The build order is bottom-up: foundation types and pure modules first, their property tests next, then orchestration, the invariant guard, persistence, pipeline wiring, and finally the offline benchmark. The router is constructed to satisfy the unchanged Invariant_Gate in `core/assemble.ts` by construction.

## Tasks

- [x] 1. Establish type foundation, provider interfaces, and PBT tooling
  - [x] 1.1 Add router union types and core records to `src/types.ts`
    - Add `ClaimType`, `FactCheckability`, `QueryVariantKind`, `MatchType`, `EvidenceOutcome`, `PrototypeVocab` union types
    - Add `QueryVariant`, `Candidate`, `ValidatedCandidate`, `AuditRecord` interfaces (reuse existing `Citation`, `EvidenceStrength`, `SourceTier`)
    - _Requirements: 1.1, 3.1, 4.1, 6.2, 6.3, 6.4_
  - [x] 1.2 Add normalizer/validator provider interfaces to `src/providers/types.ts`
    - Add `ClaimNormalizer` and `CandidateValidator` interfaces; extend `Providers` with `normalizer` and `validator`
    - _Requirements: 1.1, 1.2, 3.1, 3.2_
  - [x] 1.3 Add `fast-check` dev dependency and extend the test script
    - Add `fast-check` to `app/apps/server/package.json` devDependencies; extend the `test` script glob to include `test/router/**/*.test.ts`
    - _Requirements: (tooling for property tests below)_

- [x] 2. Implement claim normalization and fact-checkability triage
  - [x] 2.1 Implement `src/router/normalize.ts`
    - Implement the `ClaimNormalizer` interface with a deterministic seeded mock for offline; produce `Canonical_Claim`, `Claim_Type`, `Fact_Checkability` from the `Original_Claim`; record original and canonical as distinct values; force `not_fact_checkable` for `normative_opinion`, force `checkable` for `factual_event`; produce an explicit hypothesis for `implied_rhetorical` or fall back to `not_fact_checkable`; export a `triage` helper
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 1.9_
  - [x] 2.2 Write property test for normalizer well-formedness
    - **Property 1: Normalizer output is well-formed** (file `test/router/normalize.test.ts`)
    - **Validates: Requirements 1.1, 1.2**
  - [x] 2.3 Write property test for claim-type-driven fact-checkability
    - **Property 2: Claim type determines fact-checkability** (file `test/router/normalize.test.ts`)
    - **Validates: Requirements 1.3, 1.4**
  - [x] 2.4 Write unit test for rhetorical-claim canonicalization
    - Example test that an `implied_rhetorical` claim becomes an explicit checkable hypothesis, and an un-transformable one becomes `not_fact_checkable` (file `test/router/normalize.test.ts`)
    - _Requirements: 1.6, 1.8_

- [x] 3. Implement query pack generation
  - [x] 3.1 Implement `src/router/queryPack.ts`
    - Pure `QueryPackGenerator.generate` producing the four required variant kinds (`exact_normalized`, `compressed_entity_predicate`, `fact_check_style`, `counterclaim_negated`); cap at six variants; add one `source_language` + one `english` variant when a non-English language hint is present; derive `exact_normalized` from the `Canonical_Claim`; tag each variant with its kind
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 3.2 Write property test for query pack well-formedness
    - **Property 4: Query packs are well-formed** (file `test/router/queryPack.test.ts`)
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.5**
  - [x] 3.3 Write property test for non-English variant coverage
    - **Property 5: Non-English topics get a source-language and an English variant** (file `test/router/queryPack.test.ts`)
    - **Validates: Requirements 2.3**

- [x] 4. Implement retrieval over the existing provider chain
  - [x] 4.1 Implement `src/router/retrieve.ts`
    - Submit each `Query_Variant` to the existing evidence providers (no new service); flatten returned `Citation`s into tagged `Candidate`s with `fromVariant`, `retrievalRank`, and `isFactCheck` (Google Fact Check origin); set each `Candidate.sourceTier` from `classifyCitationTier` (`core/sourceTier.ts`); ignore the chain's own `evidenceStrength`; apply a per-variant result cap; work correctly with a single query
    - _Requirements: 2.6, 3.8, 5.1_
  - [x] 4.2 Write unit test that each variant is submitted exactly once
    - Example test that retrieval submits every `Query_Variant` to the provider chain exactly once (file `test/router/retrieve.test.ts`)
    - _Requirements: 2.6_
  - [x] 4.3 Write property test that source tier always comes from the policy
    - **Property 9: Source tier always comes from the policy** (file `test/router/retrieve.test.ts`)
    - **Validates: Requirements 5.1**

- [x] 5. Implement candidate validation
  - [x] 5.1 Implement `src/router/validate.ts`
    - Implement the `CandidateValidator` interface with a deterministic seeded mock; classify each `Candidate` against the **Original_Claim** (never the variant text) with exactly one `Match_Type` and a `Match_Confidence`; clamp out-of-range confidence into `[0,1]` and note the clamp; treat a validator throw as `irrelevant`
    - _Requirements: 3.1, 3.2_
  - [x] 5.2 Write property test for validator well-formedness
    - **Property 6: Validator output is well-formed** (file `test/router/validate.test.ts`)
    - **Validates: Requirements 3.1**

- [x] 6. Implement gates, routing, outcome assignment, and deterministic mappings (`src/router/outcome.ts`)
  - [x] 6.1 Implement candidate routing and the excluded-tier hard gate
    - Route `same_claim` and `contradictory_but_relevant` (with `supports=false`) into the Claim_Ledger only when `sourceTier !== 'excluded'`; route `same_topic_different_claim` to Useful_Context; `background_context` to a Context_Card; discard `irrelevant`; drop any `excluded`-tier candidate from the ledger regardless of Match_Type/Confidence; record retrieval rank, Source_Tier, Match_Type+Confidence, Evidence_Strength as four distinct signals (no combined score)
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 5.2, 5.4, 7.4_
  - [x] 6.2 Write property test for routing and the excluded-tier gate
    - **Property 8: Candidate routing honors match type and the excluded-tier hard gate** (file `test/router/routing.test.ts`)
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 5.2, 7.4**
  - [x] 6.3 Implement Evidence_Outcome assignment
    - Assign exactly one `Evidence_Outcome` per the assignment rules: `not_fact_checkable` when not checkable and no ledger-eligible candidate; strongest `matched_*` by provenance order (`fact_check > tier1_primary > institutional`) when ledger-eligible candidates exist (overriding a prior `not_fact_checkable`); `relevant_context_only` when only routed context exists; `no_sufficient_evidence` otherwise
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 6.4 Write property test for Evidence_Outcome assignment
    - **Property 10: Exactly one Evidence_Outcome is assigned per the assignment rules** (file `test/router/outcome.test.ts`)
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
  - [x] 6.5 Implement the deterministic outcome-to-strength and outcome-to-vocabulary mappings
    - Total single-valued `Evidence_Outcome → Evidence_Strength` map (with `no_sufficient_evidence` and `not_fact_checkable` → `none`); total `(Evidence_Outcome, hasSupporting, hasContradicting) → PrototypeVocab` map with the `mixed` override for matched outcomes carrying both supporting and contradicting citations
    - _Requirements: 4.7, 4.8, 4.9_
  - [x] 6.6 Write property test for the deterministic mappings
    - **Property 11: Outcome-to-strength and outcome-to-vocabulary mappings are deterministic and total** (file `test/router/mappings.test.ts`)
    - **Validates: Requirements 4.7, 4.8, 4.9**

- [x] 7. Implement the audit record builder
  - [x] 7.1 Implement `src/router/audit.ts`
    - Build exactly one `AuditRecord` per claim recording distinct Original/Canonical claims, Claim_Type, Fact_Checkability, the Query_Pack, raw candidate results, per-candidate selected/rejected + Match_Type + Match_Confidence + Source_Tier + retrieval rank (four distinct signals), and the final Evidence_Outcome; empty Query_Pack and empty candidates when `not_fact_checkable`
    - _Requirements: 1.9, 4.6, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [x] 7.2 Write property test for audit completeness
    - **Property 13: The Audit_Record is complete for every claim** (file `test/router/audit.test.ts`)
    - **Validates: Requirements 1.9, 4.6, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**

- [x] 8. Implement and wire the router orchestration (`src/router/index.ts`)
  - [x] 8.1 Implement `verifyClaim(originalClaim, deps)` orchestration
    - Sequence the six stages; short-circuit `not_fact_checkable` claims before any query pack or provider call; pass the Original_Claim (never variant text) to the validator; build `VerifiedClaim` (evidenceOutcome, evidenceStrength, prototypeVocab, citations = ledger evidence only, usefulContext, contextCards, audit); apply the error-handling defaults (normalizer throw → `not_fact_checkable`; per-variant retrieval failure → zero candidates; all variants fail → `no_sufficient_evidence`; validator throw → `irrelevant`)
    - _Requirements: 1.5, 1.7, 3.2, 4.1, 7.3_
  - [x] 8.2 Write property test that a not-fact-checkable claim is never searched
    - **Property 3: A not-fact-checkable claim is never searched** (file `test/router/index.test.ts`)
    - **Validates: Requirements 1.5, 1.7**
  - [x] 8.3 Write property test that candidates are validated against the original claim
    - **Property 7: Candidates are validated against the original claim** (file `test/router/validate.test.ts`)
    - **Validates: Requirements 3.2**
  - [x] 8.4 Write property test for the strength/citation invariant moat
    - **Property 12: Strength and citations are always consistent — the invariant moat** (file `test/router/invariant-moat.test.ts`)
    - **Validates: Requirements 9.3, 9.4, 7.1, 7.2, 7.3**

- [x] 9. Implement the invariant-gate runtime guard
  - [x] 9.1 Implement `src/router/guard.ts`
    - `assertInvariantGateIntact()` runs `assembleReport` against pinned fixtures for the four gate conditions (overclaim, evidenceless framing, empty claims, low confidence) plus the honest-`none` ready case, throwing if any outcome diverges; do not modify `core/assemble.ts`
    - _Requirements: 9.1, 9.2_
  - [x] 9.2 Write tests for the guard behavior
    - Example tests: guard passes against the real `assembleReport`; guard throws against a stub that weakens a gate condition (file `test/router/guard.test.ts`)
    - _Requirements: 9.2_

- [x] 10. Implement audit persistence
  - [x] 10.1 Add `saveAuditRecord(record: AuditRecord)` to the `Repository` port in `src/infra/ports.ts`
    - _Requirements: 6.1_
  - [x] 10.2 Implement `saveAuditRecord` in the in-memory and Postgres repositories
    - In `src/infra/memory.ts` keep a `Map<reportId, AuditRecord[]>`; in `src/infra/postgres.ts` insert the lossless `AuditRecord` JSONB blob; best-effort write that logs and does not block a ready report
    - _Requirements: 6.1_
  - [x] 10.3 Add the `audit_records` migration
    - Create `app/db/migrations/002_audit_records.sql` with the `audit_records` table and `idx_audit_report` index per the design
    - _Requirements: 6.1_

- [x] 11. Wire the router into the pipeline and worker
  - [x] 11.1 Replace the Stage 3 evidence loop in `src/pipeline/stages.ts`
    - Call `verifyClaim(...)` per extracted claim where `providers.evidence.gather` is called today; build each `Claim` from the `VerifiedClaim`; collect `usefulContext` and `contextCards` into the report; surface honest no-evidence presentation (no cited evidence for `no_sufficient_evidence`; context-only labelling for `relevant_context_only`); never present non-matching candidates as evidence
    - _Requirements: 7.1, 7.2, 7.4_
  - [x] 11.2 Wire the worker boot guard and audit persistence in `src/pipeline/worker.ts`
    - Call `assertInvariantGateIntact()` once at worker construction (refuse to start on failure); persist each `AuditRecord` via the repository after a successful pipeline run, without failing a report on a `no_sufficient_evidence` claim
    - _Requirements: 6.1, 7.3, 9.2_
  - [x] 11.3 Construct the router in the composition root `src/index.ts`
    - Build `verifyClaim` deps from the existing evidence provider list, the new `ClaimNormalizer`/`CandidateValidator` providers, and `classifyCitationTier`; add deterministic normalizer/validator mocks to `src/providers/mock.ts`
    - _Requirements: 5.1, 9.5_
  - [x] 11.4 Write integration test for the pipeline with router wired in
    - End-to-end test with seeded mocks asserting honest no-evidence presentation, context routing, and that a single unmatched claim does not fail the report (file `test/router/integration.test.ts`)
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 12. Build the offline benchmark and ship gate
  - [x] 12.1 Create `src/router/benchmark/fixtures.json`
    - Approximately 100 labeled claims spanning video/article, Dutch, recent/local, known-misinfo, and mundane-factual categories, each with one `idealOutcome` and acceptable/unacceptable URL lists
    - _Requirements: 8.1, 8.2_
  - [x] 12.2 Implement `src/router/benchmark/runner.ts`
    - Feed the same pre-extracted claim text to both `current_chain` and `router` strategies (extraction model held constant); run offline with no network/user dependency; compute and report `False_Evidence_Rate` per strategy; implement the `Ship_Gate` (approve iff `FER_router ≤ FER_current`)
    - _Requirements: 8.3, 8.4, 8.5, 8.6_
  - [x] 12.3 Write property test for False_Evidence_Rate computation
    - **Property 14: False_Evidence_Rate is computed correctly** (file `test/router/benchmark.test.ts`)
    - **Validates: Requirements 8.3**
  - [x] 12.4 Write property test for the Ship_Gate decision
    - **Property 15: The Ship_Gate approves only a non-worse strategy** (file `test/router/benchmark.test.ts`)
    - **Validates: Requirements 8.4**
  - [x] 12.5 Write property test that the benchmark holds the extraction model constant
    - **Property 16: The Benchmark holds the extraction model constant** (file `test/router/benchmark.test.ts`)
    - **Validates: Requirements 8.6**
  - [x] 12.6 Write smoke test for benchmark composition
    - Assert `fixtures.json` holds ~100 claims spanning the required categories, each with `idealOutcome` and URL lists (file `test/router/benchmark.test.ts`)
    - _Requirements: 8.1, 8.2_

- [x] 13. Enforce neutrality and dataset-licensing constraints
  - [x] 13.1 Write static checks for neutrality and banned datasets
    - Assert no Ad Fontes / AllSides / MBFC dataset is imported, and that `VerifiedClaim`/`AuditRecord` expose no content-truth verdict or creator-reliability field (file `test/router/neutrality.test.ts`)
    - _Requirements: 5.3, 9.5_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirement clauses for traceability.
- Property tests use `fast-check` with a minimum of 100 iterations and seeded deterministic `ClaimNormalizer`/`CandidateValidator` mocks, so the router's logic — not the LLM — is under test. Each property test is tagged with a comment in the format `Feature: claim-verification-router, Property {number}: {property_text}`.
- `core/assemble.ts` (the Invariant_Gate) is preserved unchanged; the runtime guard (task 9) protects it behaviorally at worker boot.
- The router is wired live only after the offline benchmark shows `FER_router ≤ FER_current`; until then it can run shadowed.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1", "5.1", "6.1", "7.1", "9.1", "10.1", "12.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "4.2", "5.2", "6.2", "6.3", "7.2", "9.2", "10.2", "12.2"] },
    { "id": 4, "tasks": ["2.3", "3.3", "4.3", "6.4", "6.5", "10.3", "12.3"] },
    { "id": 5, "tasks": ["2.4", "6.6", "8.1", "12.4"] },
    { "id": 6, "tasks": ["8.2", "8.3", "8.4", "11.1", "11.3", "12.5"] },
    { "id": 7, "tasks": ["11.2", "12.6", "13.1"] },
    { "id": 8, "tasks": ["11.4"] }
  ]
}
```
