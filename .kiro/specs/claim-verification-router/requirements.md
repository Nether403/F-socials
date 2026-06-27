# Requirements Document

## Introduction

The claim-verification-router replaces f-Socials' current near-linear, per-claim evidence search (Google Fact Check → GDELT → Tavily in `providers/chain.ts`, called once per claim in `pipeline/stages.ts`) with a router that cleanly separates **broad recall retrieval** from **strict precision validation**. The current chain launders weak evidence: a full-sentence query misses real fact-checks, a keyword query drifts to merely-related material, and whatever comes back is treated as evidence. This feature makes the Claim Ledger cite only evidence that actually matches the claim, and honestly report when it does not.

The governing risk metric is the **false-evidence rate**: a wrong citation is far worse than a missing one. A missed citation is annoying; a wrong one is reputational damage. Every design choice in this feature is biased toward precision over recall, and toward honest "no sufficient evidence found" over a dressed-up near-miss.

The launch context is a **controlled educator pilot**, not an open public launch. Educator conversations double as the source of labeled benchmark claims, so the offline benchmark in this feature is both a quality gate and a pilot artifact.

This feature is deliberately **staged and anti-over-build**. It wraps normalization (before) and validation (after) around the existing provider chain inside the existing worker and pipeline — it does not introduce a new microservice, a weighted numeric scoring model, or an 8-variant query explosion. It uses binary hard gates on match-type, confidence, and source-tier until an offline benchmark justifies anything more elaborate.

The product compass governs every requirement: **f-Socials is a lens, not a judge.** The system surfaces sources and citations, never a verdict on content and never a label on a creator. The invariant gate in `core/assemble.ts` is a codified moat that MUST be preserved unchanged: no claim may assert an evidence strength it cannot cite, and an honest "none" outcome with zero citations remains a valid served `ready` outcome.

Source credibility is **not** owned by this feature. The separate trust-and-launch-bundle Source_Tier_Policy (`classifyCitationTier` / `SourceTier`) is authoritative for citation tiers; this feature consumes that tier as one input and treats an `excluded` tier as a hard "cannot be evidence" gate.

## Glossary

- **Claim_Verification_Router**: The staged claim-checking subsystem this feature builds — normalize → triage → query pack → retrieve → validate → assemble outcome — implemented as steps wrapped around the existing provider chain inside the existing Worker and Pipeline.
- **Pipeline**: The existing analysis pipeline in `app/apps/server/src/pipeline/stages.ts` that runs transcript → extract → evidence → perspectives → invariant gate.
- **Worker**: The existing long-running BullMQ pipeline worker that processes queued analyses.
- **Provider_Chain**: The existing evidence retrieval chain in `app/apps/server/src/providers/chain.ts` (Google Fact Check → GDELT → Tavily).
- **Original_Claim**: The exact claim text extracted from the content by the LLM extraction stage, before any normalization.
- **Canonical_Claim**: The normalized, explicit, checkable restatement of the Original_Claim produced by the Claim_Normalizer.
- **Claim_Normalizer**: The pre-retrieval step that produces the Canonical_Claim, the Claim_Type, and the Fact_Checkability for a claim.
- **Claim_Type**: The classification of a claim as one of: factual event, statistical, causal, quote/paraphrase, prediction, normative/opinion, or implied/rhetorical.
- **Fact_Checkability**: Whether a claim can be checked against external evidence — one of `checkable` or `not_fact_checkable`.
- **Query_Pack**: A small set of purpose-distinct query variants generated for one checkable claim.
- **Query_Variant**: A single query within a Query_Pack, carrying its text and its purpose-kind (one of: exact normalized claim, compressed entity-predicate, fact-check-style, counterclaim/negated, source-language, or English).
- **Candidate**: A single raw result returned by the Provider_Chain for any Query_Variant, before validation.
- **Candidate_Validator**: The post-retrieval precision step that classifies each Candidate's Match_Type against the Original_Claim with a Match_Confidence.
- **Match_Type**: How a Candidate relates to the Original_Claim — one of: `same_claim`, `same_topic_different_claim`, `background_context`, `contradictory_but_relevant`, or `irrelevant`.
- **Match_Confidence**: A confidence value, in the range 0 to 1 inclusive, that the Candidate_Validator assigns to its Match_Type judgment.
- **Source_Tier**: The reliability classification of a single source, one of `tier1_primary`, `tier2_institutional`, `tier3_viewpoint`, or `excluded`, owned by the trust-and-launch-bundle Source_Tier_Policy.
- **Source_Tier_Policy**: The authoritative, versioned source-reliability classifier (`classifyCitationTier`) owned by the trust-and-launch-bundle feature. This feature consumes it and does not modify it.
- **Evidence_Outcome**: The single explicit result of checking a claim, one of: `matched_fact_check`, `matched_primary_source`, `matched_institutional_source`, `relevant_context_only`, `no_sufficient_evidence`, or `not_fact_checkable`. Consistent with the Evidence_Outcome term in the trust-and-launch-bundle requirements.
- **Evidence_Strength**: The existing backend evidence-strength vocabulary `strong | moderate | weak | none` carried on a Claim and consumed by the Invariant_Gate.
- **Claim_Ledger**: The set of claims and their citations in an Analysis_Report; only a `same_claim` (and, where appropriate, `contradictory_but_relevant`) Candidate may enter it as evidence.
- **Useful_Context**: The report region for material that is on the same topic as the claim but is a different claim.
- **Context_Card**: The existing report element (`contextCards`) for background context the content omits.
- **Audit_Record**: The complete, persisted per-claim decision record produced by the Claim_Verification_Router.
- **Benchmark**: The offline labeled set of approximately 100 claims, each with an ideal Evidence_Outcome and acceptable/unacceptable source URLs, used to measure the router.
- **False_Evidence_Rate**: The fraction of benchmark claims for which the router cites a source that does not actually match the claim (a near-miss or contradiction presented as support).
- **Ship_Gate**: The decision rule that the router's strategy is adopted only if it reduces the False_Evidence_Rate versus the current behavior on the Benchmark.
- **Invariant_Gate**: The assembly check in `core/assemble.ts` that gates a report to `ready` or `needs_review`. Preserved unchanged by this feature.
- **Analysis_Report**: The full report object for one analyzed content item.

## Requirements

### Requirement 1: Claim Normalization and Fact-Checkability Triage

**User Story:** As a trust steward, I want every claim classified and normalized before any search, so that opinions are not searched and vague rhetoric is turned into a checkable hypothesis.

#### Acceptance Criteria

1. WHEN the Claim_Normalizer receives an Original_Claim, THE Claim_Normalizer SHALL assign exactly one Claim_Type from the set {factual event, statistical, causal, quote/paraphrase, prediction, normative/opinion, implied/rhetorical}.
2. WHEN the Claim_Normalizer receives an Original_Claim, THE Claim_Normalizer SHALL assign exactly one Fact_Checkability value of `checkable` or `not_fact_checkable`.
3. WHEN the Claim_Normalizer assigns a Claim_Type of normative/opinion, THE Claim_Normalizer SHALL assign Fact_Checkability `not_fact_checkable`.
4. WHEN the Claim_Normalizer assigns a Claim_Type of factual event, THE Claim_Normalizer SHALL assign Fact_Checkability `checkable` and SHALL NOT assign `not_fact_checkable`.
5. IF a claim has Fact_Checkability `not_fact_checkable`, THEN THE Claim_Verification_Router SHALL NOT generate a Query_Pack for that claim and SHALL NOT call the Provider_Chain for that claim.
6. WHEN the Claim_Normalizer assigns a Claim_Type of implied/rhetorical, THE Claim_Normalizer SHALL produce a Canonical_Claim that states an explicit, checkable hypothesis before any search occurs.
7. IF the Claim_Normalizer cannot transform an implied/rhetorical claim into an explicit, checkable hypothesis, THEN THE Claim_Normalizer SHALL assign Fact_Checkability `not_fact_checkable` and THE Claim_Verification_Router SHALL skip verification for that claim.
8. WHEN the Claim_Normalizer processes a checkable claim, THE Claim_Normalizer SHALL produce a Canonical_Claim derived from the Original_Claim.
9. THE Claim_Normalizer SHALL record the Original_Claim and the Canonical_Claim as distinct values.

### Requirement 2: Query Pack Generation for Recall

**User Story:** As a developer tuning retrieval, I want each checkable claim expanded into a small set of purpose-distinct queries, so that recall improves without exploding cost or drifting off-topic.

#### Acceptance Criteria

1. WHEN the Claim_Verification_Router processes a claim with Fact_Checkability `checkable`, THE Query_Pack_Generator SHALL produce a Query_Pack containing the four Query_Variant kinds: exact normalized claim, compressed entity-predicate, fact-check-style, and counterclaim/negated.
2. THE Query_Pack_Generator SHALL produce no more than six Query_Variant entries for a single claim.
3. WHERE a claim's topic warrants a source language other than English, THE Query_Pack_Generator SHALL add one source-language Query_Variant and one English Query_Variant.
4. THE Query_Pack_Generator SHALL associate each Query_Variant with its purpose-kind.
5. WHEN the Query_Pack_Generator builds the exact-normalized Query_Variant, THE Query_Pack_Generator SHALL derive that variant from the Canonical_Claim.
6. THE Query_Pack_Generator SHALL submit each Query_Variant to the existing Provider_Chain without creating a new evidence service.

### Requirement 3: Strict Candidate Validation and the Same-Claim Evidence Rule

**User Story:** As a reader, I want only sources that actually match the claim to be cited as evidence, so that the report never dresses up a near-miss as verification.

#### Acceptance Criteria

1. WHEN the Provider_Chain returns a Candidate for any Query_Variant, THE Candidate_Validator SHALL classify that Candidate with exactly one Match_Type against the Original_Claim and SHALL assign a Match_Confidence in the range 0 to 1 inclusive.
2. THE Candidate_Validator SHALL classify a Candidate against the Original_Claim and not against any Query_Variant text.
3. WHERE a Candidate's Match_Type is `same_claim`, THE Claim_Verification_Router SHALL permit that Candidate to enter the Claim_Ledger as evidence, subject to the Source_Tier gate in Requirement 5.
4. WHERE a Candidate's Match_Type is `contradictory_but_relevant`, THE Claim_Verification_Router SHALL permit that Candidate to enter the Claim_Ledger as evidence recorded as contradicting the claim, subject to the Source_Tier gate in Requirement 5.
5. WHERE a Candidate's Match_Type is `same_topic_different_claim`, THE Claim_Verification_Router SHALL route that Candidate to Useful_Context and SHALL NOT enter that Candidate into the Claim_Ledger as evidence.
6. WHERE a Candidate's Match_Type is `background_context`, THE Claim_Verification_Router SHALL route that Candidate to a Context_Card and SHALL NOT enter that Candidate into the Claim_Ledger as evidence.
7. IF a Candidate's Match_Type is `irrelevant`, THEN THE Claim_Verification_Router SHALL discard that Candidate.
8. THE Candidate_Validator SHALL operate correctly when the Provider_Chain is driven by a single query, so that validation protects the Claim_Ledger even before Query_Pack generation is enabled.

### Requirement 4: Evidence Outcome Taxonomy and Vocabulary Reconciliation

**User Story:** As a developer and as a reader, I want one explicit outcome per checked claim and one consistent vocabulary, so that the backend state and the served report agree on what was found.

#### Acceptance Criteria

1. WHEN the Claim_Verification_Router finishes processing a claim, THE Claim_Verification_Router SHALL assign that claim exactly one Evidence_Outcome from {`matched_fact_check`, `matched_primary_source`, `matched_institutional_source`, `relevant_context_only`, `no_sufficient_evidence`, `not_fact_checkable`}, consistent with that claim's Fact_Checkability status.
2. WHEN a claim has Fact_Checkability `not_fact_checkable` and no Candidate with Match_Type `same_claim` or `contradictory_but_relevant` is found for it, THE Claim_Verification_Router SHALL assign that claim the Evidence_Outcome `not_fact_checkable`.
3. IF evidence processing runs for a claim assessed as `not_fact_checkable` and returns a Candidate whose Match_Type permits it to enter the Claim_Ledger as evidence, THEN THE Claim_Verification_Router SHALL override the `not_fact_checkable` outcome with the Evidence_Outcome reflecting the evidence found.
4. WHEN a checkable claim produces no Candidate whose Match_Type permits it to enter the Claim_Ledger as evidence, THE Claim_Verification_Router SHALL assign that claim the Evidence_Outcome `no_sufficient_evidence` or `relevant_context_only`.
5. WHEN a checkable claim produces only routed Useful_Context or Context_Card material and no Claim_Ledger evidence, THE Claim_Verification_Router SHALL assign that claim the Evidence_Outcome `relevant_context_only`.
6. THE Claim_Verification_Router SHALL record the Evidence_Outcome as an explicit backend state on the claim.
7. THE Claim_Verification_Router SHALL define and own a deterministic mapping from each Evidence_Outcome to one Evidence_Strength value in {`strong`, `moderate`, `weak`, `none`}.
8. WHEN the Claim_Verification_Router maps an Evidence_Outcome of `no_sufficient_evidence` or `not_fact_checkable` to an Evidence_Strength, THE Claim_Verification_Router SHALL map it to `none`.
9. THE Claim_Verification_Router SHALL define and own a deterministic mapping from each Evidence_Outcome to the prototype report vocabulary {`supported`, `mixed`, `weak`, `insufficient`}, resolving the existing backend-versus-prototype vocabulary mismatch.

### Requirement 5: Source Tier as a Hard Evidence Gate

**User Story:** As a trust steward, I want excluded sources to never be cited as evidence, so that the router reuses the authoritative tier policy and adds no source-reliability logic of its own.

#### Acceptance Criteria

1. THE Claim_Verification_Router SHALL obtain each Candidate's Source_Tier from the trust-and-launch-bundle Source_Tier_Policy and SHALL NOT compute its own source-reliability rating.
2. IF a Candidate's Source_Tier is `excluded`, THEN THE Claim_Verification_Router SHALL NOT enter that Candidate into the Claim_Ledger as evidence regardless of its Match_Type or Match_Confidence, while still permitting the Source_Tier_Policy to compute that Candidate's tier before it is blocked.
3. WHILE the commercial-use license for a source-reliability dataset is unresolved, THE Claim_Verification_Router SHALL NOT use Ad Fontes, AllSides, MBFC, or that dataset; WHERE proper commercial licensing for such a dataset is obtained, THE Claim_Verification_Router MAY use it.
4. THE Claim_Verification_Router SHALL record retrieval ranking, Source_Tier, Match_Type with Match_Confidence, and Evidence_Strength as four distinct signals and SHALL NOT collapse them into a single combined score.

### Requirement 6: Per-Claim Audit and Query Logging

**User Story:** As an operator handling a disputed report, I want a complete persisted decision record for every claim, so that any evidence outcome can be reproduced and tuned.

#### Acceptance Criteria

1. WHEN the Claim_Verification_Router finishes processing a claim, THE Claim_Verification_Router SHALL persist an Audit_Record for that claim.
2. THE Audit_Record SHALL contain the Original_Claim, the Canonical_Claim, the Claim_Type, the Fact_Checkability, and the Query_Pack used.
3. THE Audit_Record SHALL contain the raw Candidate results returned by the Provider_Chain.
4. THE Audit_Record SHALL record, for each Candidate, whether it was selected as evidence or rejected, its Match_Type, its Match_Confidence, and its Source_Tier.
5. THE Audit_Record SHALL record the final Evidence_Outcome assigned to the claim.
6. WHEN a claim has Fact_Checkability `not_fact_checkable`, THE Audit_Record SHALL record that the claim was not searched and SHALL record an empty Query_Pack and empty Candidate results.

### Requirement 7: Honest No-Evidence Presentation

**User Story:** As a reader, I want the report to say plainly when no source directly verifies a claim, so that I am never misled by related-but-non-matching material.

#### Acceptance Criteria

1. WHEN a claim's Evidence_Outcome is `no_sufficient_evidence`, THE Analysis_Report SHALL state that no source directly verifying the specific claim was found and SHALL NOT present any cited evidence for that claim.
2. WHERE a claim's Evidence_Outcome is `relevant_context_only`, THE Analysis_Report SHALL present the related material as context and SHALL state that the material does not directly verify the claim.
3. THE Claim_Verification_Router SHALL treat the Evidence_Outcome `no_sufficient_evidence` as a successful, served outcome and SHALL NOT mark the claim or report as failed solely because of that outcome, including when an individual claim simply lacks evidence.
4. THE Analysis_Report SHALL NOT present a `same_topic_different_claim`, `background_context`, or `irrelevant` Candidate as evidence that supports or contradicts the claim.

### Requirement 8: Offline Benchmark and False-Evidence-Rate Ship Gate

**User Story:** As a product owner, I want the router measured against a labeled benchmark before adoption, so that the strategy ships only if it actually reduces wrong citations.

#### Acceptance Criteria

1. THE Benchmark SHALL contain approximately 100 labeled claims spanning video and article sources, Dutch claims, recent or local claims, known misinformation claims, and mundane factual claims.
2. THE Benchmark SHALL label each claim with one ideal Evidence_Outcome and with acceptable and unacceptable source URLs.
3. WHEN the Benchmark is executed against a retrieval strategy, THE Benchmark SHALL report the False_Evidence_Rate for that strategy.
4. THE Ship_Gate SHALL approve adoption of the Claim_Verification_Router strategy when its False_Evidence_Rate on the Benchmark is equal to or lower than the False_Evidence_Rate of the current Provider_Chain behavior.
5. THE Benchmark SHALL execute offline and SHALL NOT require any user-facing A/B test.
6. WHEN the Benchmark is executed, THE Benchmark SHALL hold the LLM claim-extraction model constant across all compared strategies, so that the extraction-model confound does not distort the measured result.

### Requirement 9: Preserve the Invariant Gate and Neutrality

**User Story:** As the steward of f-Socials' credibility, I want the invariant gate and neutrality preserved, so that this feature strengthens trust without weakening the moat.

#### Acceptance Criteria

1. THE Claim_Verification_Router SHALL NOT modify the behavior of the Invariant_Gate in `core/assemble.ts`.
2. THE Claim_Verification_Router SHALL include a runtime check that detects and prevents modification of the Invariant_Gate behavior rather than relying solely on code review and testing.
3. WHEN a claim's Evidence_Strength is `weak`, `moderate`, or `strong`, THE Claim_Verification_Router SHALL attach at least one Citation to that claim, so that the Invariant_Gate continues to permit `ready`.
4. WHEN a claim's Evidence_Outcome maps to Evidence_Strength `none`, THE Claim_Verification_Router SHALL attach zero Citations to that claim, preserving the honest-none outcome as a valid `ready` state.
5. WHILE the Claim_Verification_Router is processing claims with citations, THE Claim_Verification_Router SHALL NOT produce any verdict about content factual truthfulness and SHALL NOT produce any reliability rating attached to a content creator; WHILE no claims with citations are being processed, THE Claim_Verification_Router SHALL produce no creator reliability rating.

## Non-Goals

The following are explicitly out of scope for this feature. They are recorded to keep the staged, anti-over-build posture visible.

- **Weighted numeric candidate scoring.** This feature SHALL NOT encode a weighted scoring model with fixed numeric weights (for example `0.35·semanticMatch + 0.20·entityMatch + …`). It uses binary hard gates on Match_Type, Match_Confidence, and Source_Tier instead, until the Benchmark justifies a weighted model. Guessed weights MUST NOT be presented as if measured.
- **A standalone verify-claim microservice.** This feature SHALL NOT introduce a `/internal/evidence/verify-claim` service. Normalization-before and validation-after are implemented as steps wrapped around the existing Provider_Chain inside the existing Worker and Pipeline.
- **Paid source-reliability datasets.** This feature SHALL NOT use MBFC, Ad Fontes, AllSides, or any paid source-reliability dataset. It reuses the open-signal Source_Tier_Policy.
- **Changing the LLM extraction model.** This feature does not change the extraction model. See the Assumptions section for the related benchmark constraint.
- **No UI A/B test.** Measurement is offline only; no user-facing experiment is built in this feature.

## Dependencies and Assumptions

- **Source_Tier_Policy dependency.** This feature depends on the trust-and-launch-bundle Source_Tier_Policy (`classifyCitationTier`) existing and being authoritative for citation tiers. This feature consumes the tier and treats `excluded` as a hard non-evidence gate.
- **Invariant_Gate is fixed.** The behavior of `core/assemble.ts` is treated as fixed; this feature does not edit it.
- **Per-claim flow may be reorganized.** Evidence retrieval today is sequential per claim. This feature may reorganize the per-claim flow (normalize → query pack → retrieve → validate → assemble outcome) but stays within the existing modular monolith and Worker.
- **Extraction-model confound (assumption).** The current lite extraction model extracts far fewer claims than heavier models (roughly 2 versus 8 on the same transcript). This confound MUST be held constant when running the Benchmark, or the Benchmark measures the wrong thing.
- **Evidence_Outcome vocabulary alignment.** The Evidence_Outcome vocabulary defined here is authoritative and is kept consistent with the Evidence_Outcome glossary term in the trust-and-launch-bundle requirements.
