// Stage 4 of the Claim_Verification_Router: candidate collection over the EXISTING
// evidence providers (Requirements 2.6, 3.8, 5.1). No new evidence service.
//
// The shipped Provider_Chain (providers/chain.ts) is first-wins: the first provider
// that returns citations short-circuits the rest. The router needs the opposite —
// collect candidates from every provider for a given Query_Variant and let the
// Candidate_Validator (Stage 5) own precision downstream. So retrieval here calls the
// provider LIST directly rather than the chained EvidenceProvider, and tags every
// citation with the metadata the gates and audit need.
//
// Three deliberate choices, each tied to a requirement:
//   - Source_Tier is recomputed from classifyCitationTier for every candidate and is
//     NEVER taken from the provider's own guess (googleFactCheck hardcodes
//     tier2_institutional; tavily has its own ad-hoc allowlist). The offline
//     Source_Tier_Policy is the single authority (Req 5.1).
//   - The chain's own evidenceStrength is ignored — strength is the router's decision,
//     assigned later from the Evidence_Outcome (Req 4.7).
//   - isFactCheck is known precisely from wiring (which provider is the Google Fact
//     Check one), not guessed from citation shape, so the outcome taxonomy can
//     distinguish matched_fact_check without a fragile heuristic.

import type { Candidate, QueryVariant, SourceTier } from '../types';
import type { EvidenceProvider } from '../providers/types';

// A labeled evidence provider. `isFactCheck` marks the Google Fact Check provider;
// the composition root (index.ts) sets it when it builds the provider list, so origin
// is determined by construction rather than inferred from a citation's URL or name.
export interface RetrievalSource {
  provider: EvidenceProvider;
  isFactCheck: boolean;
}

export interface RetrieveDeps {
  sources: RetrievalSource[];
  classifyTier: (sourceUrl: string) => SourceTier; // classifyCitationTier
  perVariantCap?: number; // max candidates kept per Query_Variant
}

// Bounds candidate volume per Req 2.2's spirit (total volume ≤ variants × cap).
export const DEFAULT_PER_VARIANT_CAP = 10;

// Factory: returns a per-variant retrieve function matching VerifyDeps.retrieve in the
// router orchestration. Each call submits one Query_Variant to every source's gather()
// exactly once and flattens the returned Citations into tagged Candidates.
export function makeRetrieve(deps: RetrieveDeps): (variant: QueryVariant) => Promise<Candidate[]> {
  const cap = deps.perVariantCap ?? DEFAULT_PER_VARIANT_CAP;

  return async function retrieve(variant: QueryVariant): Promise<Candidate[]> {
    // Query every provider for this variant (not first-wins). Promise.all preserves
    // source order so retrievalRank is deterministic across runs.
    // ponytail: a provider that rejects fails the whole variant via Promise.all, which
    // the orchestration catches as "zero candidates for this variant" (design error
    // handling). The shipped providers already catch internally and resolve to [], so
    // this only bites a future provider that forgets to. Upgrade path: per-source
    // try/catch if isolating one flaky provider from the rest becomes worth the code.
    const perSource = await Promise.all(
      deps.sources.map(async (s) => ({
        isFactCheck: s.isFactCheck,
        citations: (await s.provider.gather(variant.text)).citations,
      })),
    );

    const candidates: Candidate[] = [];
    for (const { isFactCheck, citations } of perSource) {
      for (const c of citations) {
        candidates.push({
          sourceUrl: c.sourceUrl,
          sourceName: c.sourceName,
          excerpt: c.excerpt,
          sourceTier: deps.classifyTier(c.sourceUrl), // authoritative policy, not the provider
          isFactCheck,
          fromVariant: variant.kind,
          retrievalRank: candidates.length, // 0-based rank within this variant's flattened results
        });
        if (candidates.length >= cap) return candidates; // per-variant result cap
      }
    }
    return candidates;
  };
}
