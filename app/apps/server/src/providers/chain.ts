// Composable evidence chain: try providers in order, first one that returns
// citations wins. Authoritative sources go first (fact-check), broad retrieval
// after (Tavily), with room to insert GDELT etc. between them later.

import type { EvidenceProvider } from './types';

export function chainEvidence(providers: EvidenceProvider[]): EvidenceProvider {
  return {
    async gather(claimText: string) {
      for (const provider of providers) {
        const result = await provider.gather(claimText);
        if (result.citations.length > 0) return result;
      }
      return { evidenceStrength: 'none', citations: [] };
    },
  };
}
