Generate a query pack, not a query

For each claim, generate 4–8 query variants, each with a purpose.

For example:

```ts
interface FactCheckQueryPack {
  claimId: string;
  originalClaim: string;
  claimType: 'factual' | 'statistical' | 'causal' | 'quote' | 'prediction' | 'normative' | 'implied';
  language: string;
  entities: string[];
  dateRange?: { start?: string; end?: string };
  queries: {
    kind:
      | 'exact_normalized'
      | 'compressed_core'
      | 'entity_predicate'
      | 'quote_fragment'
      | 'factcheck_style'
      | 'counterclaim'
      | 'local_language'
      | 'english_translation';
    query: string;
    expectedPrecision: 'high' | 'medium' | 'low';
  }[];
}
```

The variants should include:

**Exact normalized claim**
Useful when the claim is already canonical.

**Compressed core claim**
Strip adjectives, hedging, rhetorical phrasing, filler.

**Entity-predicate-object query**
Who did what, to whom, where, when.

**Fact-check style query**
Add terms like “claim,” “fact check,” “hoax,” “misleading,” “false,” but carefully.

**Quote-fragment query**
For quote claims, search the unusual phrase, not the whole sentence.

**Counterclaim query**
Useful because fact-checks often phrase things as “No, X did not happen.”

**Language variant**
Important for Dutch/English beta. Query in source language and English when the topic is international.

Google’s API supports a `languageCode` filter, but region is not currently considered, so language filtering helps but does not solve local relevance. ([Google for Developers][1])

### 3. Separate recall retrieval from precision validation

This is the big architectural correction.

The search layer should be allowed to retrieve broadly. The validation layer should be strict.

Current instinct:

> Better query → better answer.

Ideal system:

> Broad query pack → candidate pool → strict claim-match validation → evidence classification.

A retrieved fact-check is only useful if it matches the claim at the semantic level. That means after retrieval, the LLM or a smaller verifier should score:

```ts
interface CandidateClaimMatch {
  candidateUrl: string;
  retrievedClaimText: string;
  originalClaimText: string;
  matchType:
    | 'same_claim'
    | 'same_topic_different_claim'
    | 'background_context'
    | 'contradictory_but_relevant'
    | 'irrelevant';
  matchConfidence: number;
  reason: string;
}
```

Only `same_claim` and sometimes `contradictory_but_relevant` should enter the Claim Ledger as evidence. `same_topic_different_claim` belongs in Useful Context, not evidence. `background_context` belongs in Context Cards. `irrelevant` is trash. Beautiful, well-formatted trash, but trash.

This is where the product earns trust.

## The three evidence outcomes should be first-class

I would formalize the three outcomes from the earlier feedback:

1. **Matched evidence found**
2. **Relevant context found, but no direct verification**
3. **No sufficient evidence found** 

These should not be buried in prose. They should be explicit backend states.

```ts
type VerificationOutcome =
  | 'matched_fact_check'
  | 'matched_primary_source'
  | 'matched_institutional_source'
  | 'relevant_context_only'
  | 'no_sufficient_evidence'
  | 'not_fact_checkable';
```

This keeps the “lens, not a judge” posture intact. It also prevents the UI from implying that every cited source verifies or debunks the claim. Some sources merely contextualize.

## Current query strategy: what I suspect is happening

Based on your notes, I suspect the current query behavior is too linear:

```ts
for each claim:
  searchFactCheck(claim.text)
  if no results:
    searchTavily(claim.text)
```

Maybe with minor shortening.

That is acceptable for prototype wiring. But it will not survive real content.

The failure modes:

### Full-sentence query miss

The extracted claim includes too much phrasing from the creator:

> “What they don’t want you to know is that climate lockdowns are already being prepared across Europe.”

Fact-checks may phrase this as:

> “No evidence governments are planning climate lockdowns.”

Full-sentence query misses.

### Keyword query drift

A shortened query like:

> climate lockdowns Europe

may retrieve articles about climate policy, pandemic lockdowns, emissions regulations, or conspiracy claims. Some are related, not matching.

### Claim ambiguity

> “They admitted it in the report.”

Who is “they”? Which report? The query needs context from surrounding transcript, title, channel, date, and cited entities.

### Recent/local claims

Fact Check API may have nothing. Tavily may find news. GDELT may find many hits but not direct verification. The UI must show “related reporting,” not “evidence confirms.”

### Fact-check phrasing mismatch

Fact-checks often use negated or corrective titles. Query generation needs negation-aware variants.

### Model extraction bottleneck

Your debt ledger notes Gemini `3.1-flash-lite` extracts fewer claims than heavier models, 2 versus about 8 on the same transcript.  That matters for query tuning because retrieval can only tune claims it receives. If extraction under-samples claims, query tuning may look “better” simply because the system avoided hard claims. That is the analytics goblin hiding under the bed.

## The ideal retrieval cascade

I would implement the fact-check/evidence layer as a cascade with explicit stopping rules.

### Stage A — Normalize the claim

Inputs:

* claim text
* transcript span
* surrounding transcript
* title
* source URL
* publish date if available
* language
* entities

Output:

* canonical claim
* claim type
* query pack
* fact-checkability status

If the claim is normative or vague, skip direct fact-check search and mark it as `not_fact_checkable` or `needs_context`.

### Stage B — Google Fact Check high-precision pass

Use:

* exact normalized claim
* compressed core claim
* fact-check style query
* language filter where appropriate
* max age if claim is recent

Return only candidates with strong semantic match.

### Stage C — Google Fact Check recall pass

Use shorter variants and counterclaim variants.

But candidates from this pass should require stricter validation before being used as claim evidence.

### Stage D — General evidence retrieval

Use Tavily/GDELT/web search for:

* primary sources
* institutional reporting
* official documents
* academic sources
* reputable news context

This should not be called “fact check” internally. It is evidence/context retrieval.

### Stage E — Candidate validation

Score candidate against original claim:

* same claim?
* same topic but different claim?
* supports?
* contradicts?
* contextual only?
* source tier?
* date relevance?
* geography relevance?
* entity match?

### Stage F — Evidence assembly

Map to UI:

* Strong evidence: direct matched fact-check or primary/institutional source, multiple sources, high claim match.
* Moderate: direct but limited source base.
* Weak: relevant but indirect.
* None: no sufficient evidence.
* Not fact-checkable: opinion/normative/too vague.

Your current backend vocabulary already uses `strong | moderate | weak | none`, while the prototype UI uses `supported | mixed | weak | insufficient`; the debt ledger says this mapping still needs frontend reconciliation.  I would resolve that as part of query tuning because users must understand the difference between “weak evidence” and “no matched fact-check.”

## What to A/B test

Do not A/B the UI yet. A/B the retrieval pipeline offline first.

Build a small benchmark set:

* 50 YouTube/video transcript claims
* 50 article claims
* 25 Dutch claims
* 25 recent/local claims
* 25 known conspiracy/misinfo claims
* 25 boring factual claims

For each claim, manually label:

```ts
{
  claim: string;
  idealOutcome:
    | 'matched_fact_check'
    | 'matched_primary_source'
    | 'relevant_context_only'
    | 'no_sufficient_evidence'
    | 'not_fact_checkable';
  acceptableUrls: string[];
  unacceptableNearMisses: string[];
}
```

Then compare strategies:

| Strategy | Description                                     | Expected behavior                |
| -------- | ----------------------------------------------- | -------------------------------- |
| A        | full extracted claim only                       | high precision, low recall       |
| B        | keyword compression only                        | higher recall, worse relevance   |
| C        | LLM query pack                                  | best balance if validation works |
| D        | query pack + semantic candidate validation      | likely ideal                     |
| E        | query pack + validation + source-tier weighting | production candidate             |

Metrics:

* **Direct match recall:** did it find a real matching fact-check/source?
* **Near-miss rate:** did it attach same-topic/different-claim evidence?
* **False evidence rate:** did it imply support/contradiction incorrectly?
* **No-evidence honesty:** did it correctly say “no sufficient evidence”?
* **Latency per claim**
* **Cost per analyzed report**
* **Citation usefulness judged by humans**

The most important metric is not raw recall. It is:

> **false evidence rate**

A missed citation is annoying. A wrong citation is reputational cyanide.

## Ideal scoring model

For each candidate source, compute something like:

```ts
candidateScore =
  0.35 * semanticClaimMatch
+ 0.20 * entityMatch
+ 0.15 * sourceTier
+ 0.10 * dateRelevance
+ 0.10 * geographyRelevance
+ 0.10 * evidenceSpecificity
```

Then use hard gates:

```ts
if semanticClaimMatch < 0.72:
  cannot be claim evidence

if sourceTier === 'excluded':
  cannot be evidence

if claimType === 'statistical' && no matching metric/date/geography:
  downgrade to context

if claimType === 'quote' && no direct quote/source transcript:
  downgrade to weak or context
```

That is more reliable than asking the LLM, “Is this good evidence?” and hoping it does not become an overconfident intern with a flamethrower.

## Query generation rules by claim type

### Factual event claims

Use:

* named entities
* action verb
* date/time
* place
* event noun

Avoid adjectives.

Bad query:

> “Shocking secret deal proves the mayor betrayed residents”

Good queries:

> mayor secret deal residents fact check
> mayor signed deal residents [city]
> [mayor name] [project name] agreement

### Statistical claims

Require:

* metric
* number
* geography
* time period
* population

If the source lacks those, do not rate it strong.

Example query pack:

> Netherlands violent crime 40% increase 2024
> CBS violent crime rate Netherlands 2024
> claim crime increased 40 percent Netherlands

### Causal claims

Causal claims are dangerous. Require studies, official analysis, or multiple institutional sources.

Mark many as:

> relevant context found, no direct verification

Do not let the system pretend correlation is evidence.

### Quote claims

Search:

* exact quote fragment
* speaker + rare phrase
* speaker + topic + “said”

Use transcript/source video when available. If no original source, don’t claim certainty.

### Implied claims

Convert to explicit hypothesis first.

Original:

> “Ask yourself why they’re suddenly deleting all the data.”

Canonical:

> “Authorities are deleting public data about [topic].”

Then query that.

### Normative claims

Do not fact-check them. You can analyze framing, rhetoric, and source basis, but not truth.

## The UI should expose uncertainty gracefully

The report should not say:

> “No fact check found.”

That sounds like shrugging.

Better:

> “No direct fact-check match found. Related reporting covers X and Y, but we did not find a source that directly verifies this specific claim.”

That is precise and non-judgmental.

For each claim card, I would show:

* **Claim**
* **What we checked**
* **Evidence result**
* **Sources found**
* **Why this evidence does / does not directly match**
* **Dispute / suggest source**

This matches the product’s requirement that the Claim Ledger include verifiability, evidence strength, source basis, confidence, and citations. 

## The current source-tier issue affects query tuning

Your debt ledger says source-tier classification is currently naive and under-rates sources like WRI, Frontiers, TheJournal.ie, and academic journals as Tier 3, with a note to upgrade to a real source-reliability dataset after licensing checks. 

That matters because query tuning and source ranking are coupled.

A better query may retrieve a good source, but if your source-tier classifier mishandles it, the system may downgrade good evidence. Conversely, a broad query may retrieve mediocre sources that look acceptable because the classifier is too crude.

Ideal state:

* separate **retrieval ranking** from **source credibility**
* separate **source credibility** from **claim match**
* separate **claim match** from **evidence strength**

Do not collapse those into one “confidence” soup.

## My recommended near-term implementation

Do this in four steps.

### Step 1 — Add query logging

For every claim, store:

```ts
{
  claimId,
  originalClaim,
  normalizedClaim,
  claimType,
  queryPack,
  providerResults,
  selectedCitations,
  rejectedCandidates,
  rejectionReasons,
  finalOutcome
}
```

Without this, tuning is just divination with better indentation.

### Step 2 — Implement query packs

Start with 4 variants:

1. exact normalized claim
2. compressed entity-predicate query
3. fact-check style query
4. counterclaim/negated query

Do not overbuild yet.

### Step 3 — Add candidate validation

Every retrieved candidate must be classified:

* same claim
* related context
* near miss
* irrelevant

Only same-claim candidates can support a Claim Ledger evidence rating.

### Step 4 — Run a 100-claim offline benchmark

No UI changes. No grand architecture cathedral. Just measure.

Compare:

* current strategy
* shorter query strategy
* query pack strategy
* query pack + validation

Ship only if near-miss citation rate drops.

## The ideal long-term state

Longer term, the fact-check layer should become a reusable internal service:

```ts
POST /internal/evidence/verify-claim
{
  claim,
  transcriptSpan,
  surroundingContext,
  language,
  sourceMetadata
}
```

Returns:

```ts
{
  canonicalClaim,
  claimType,
  factCheckability,
  queryPack,
  candidates,
  selectedEvidence,
  outcome,
  confidence,
  auditTrail
}
```

That audit trail is not optional. Your feedback doc already recommended storing prompt version, model provider, model name, analysis policy version, and source policy version because disputed reports require reproducibility.  The v1 spec also says prompts should be pinned and versioned so reports can be reproduced or audited. 

For f-Socials, auditability is not backend neatness. It is the product.

## My blunt recommendation

Do **not** simply switch from full-sentence queries to shorter keyword queries.

That would improve demo hit-rate and quietly poison trust.

The correct move is:

> Keep full-sentence/exact queries as the high-precision pass, add shorter generated query variants for recall, and insert a strict semantic validation layer before anything becomes “evidence.”

The current state is good enough for internal testing. It is not good enough for public trust.

The ideal state is not “better fact-check search.” It is a **claim verification router** that knows the difference between:

* this exact claim was fact-checked,
* this topic has relevant context,
* this source supports part of the claim,
* this is too vague to verify,
* and we found nothing strong enough to show.

That last outcome should feel like a successful system behavior, not a failure.

Because for f-Socials, the dangerous output is not “we don’t know.”

The dangerous output is “we found something vaguely nearby and dressed it up as knowledge.”

[1]: https://developers.google.com/fact-check/tools/api/reference/rest/v1alpha1/claims/search "Method: claims.search  |  Fact Check Tools API  |  Google for Developers"
[2]: https://developers.google.com/fact-check/tools/api/reference/rest/v1alpha1/claims "REST Resource: claims  |  Fact Check Tools API  |  Google for Developers"
[3]: https://www.claimreviewproject.com/the-facts-about-claimreview "The Facts About ClaimReview — The ClaimReview Project"
