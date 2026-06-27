// Checks the evidence chain: try providers in order, first with citations wins,
// fall through to a clean 'none' if nobody has anything.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chainEvidence } from '../src/providers/chain';
import type { EvidenceProvider } from '../src/providers/types';

const empty: EvidenceProvider = {
  async gather() {
    return { evidenceStrength: 'none', citations: [] };
  },
};

function withCitation(name: string): EvidenceProvider {
  return {
    async gather() {
      return {
        evidenceStrength: 'weak',
        citations: [
          { sourceUrl: `https://${name}.example`, sourceName: name, sourceTier: 'tier2_institutional', supports: null },
        ],
      };
    },
  };
}

test('chain returns the first provider that has citations', async () => {
  const r = await chainEvidence([empty, withCitation('second'), withCitation('third')]).gather('x');
  assert.equal(r.citations.length, 1);
  assert.equal(r.citations[0]?.sourceName, 'second'); // not 'third' — first hit wins
});

test('chain falls through to none when no provider has citations', async () => {
  const r = await chainEvidence([empty, empty]).gather('x');
  assert.equal(r.evidenceStrength, 'none');
  assert.equal(r.citations.length, 0);
});
