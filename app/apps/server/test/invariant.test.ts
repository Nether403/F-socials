// The one runnable check (product-definition §8).
// Fails if the lens ever becomes a judge: no claim without a citation,
// no framing signal without evidence. If this test must be weakened to ship a
// feature, the feature is wrong, not the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleReport, type AssembleInput } from '../src/core/assemble';
import type { Claim, FramingSignal } from '../src/types';

function citedClaim(text: string): Claim {
  return {
    id: 'c1',
    claimText: text,
    verifiability: 'verifiable',
    evidenceStrength: 'moderate',
    confidence: 0.7,
    citations: [
      {
        sourceUrl: 'https://example.org/s',
        sourceName: 'Src',
        sourceTier: 'tier2_institutional',
        supports: null,
      },
    ],
  };
}

function uncitedClaim(text: string): Claim {
  // asserts 'moderate' evidence but shows no citation — this is overclaiming
  return { ...citedClaim(text), citations: [] };
}

function noEvidenceClaim(text: string): Claim {
  // honest "no external review found" — evidenceStrength 'none', no citation
  return { ...citedClaim(text), evidenceStrength: 'none', citations: [] };
}

function goodSignal(): FramingSignal {
  return {
    technique: 'Emotional Language',
    severity: 'medium',
    description: 'High-arousal wording that primes the reader.',
    examples: [
      { text: 'They ALWAYS lie!', explanation: 'Absolutist, emotionally charged phrasing.', startIndex: 0, endIndex: 16 },
    ],
  };
}

function base(overrides: Partial<AssembleInput>): AssembleInput {
  return {
    tldr: 'summary',
    issueFrame: { label: 'mixed', x: 0, y: 0 },
    claims: [citedClaim('A study found X.')],
    framingSignals: [goodSignal()],
    contextCards: [],
    perspectives: [],
    confidence: 0.7,
    ...overrides,
  };
}

test('a claim that asserts evidence strength but has no citation is held for review', () => {
  const r = assembleReport(base({ claims: [citedClaim('ok'), uncitedClaim('overclaimed')] }));
  assert.equal(r.status, 'needs_review');
  assert.ok(r.reasons.some((m) => m.includes('citation')));
});

test('a claim with no evidence and no citation is a valid honest state (ready)', () => {
  // "no external review found" must be shown, not hidden behind review
  const r = assembleReport(base({ claims: [noEvidenceClaim('unreviewed but honest')] }));
  assert.equal(r.status, 'ready');
});

test('a framing signal without evidence examples is held for review', () => {
  const bad: FramingSignal = { technique: 'x', severity: 'low', description: 'd', examples: [] };
  const r = assembleReport(base({ framingSignals: [bad] }));
  assert.equal(r.status, 'needs_review');
  assert.ok(r.reasons.some((m) => m.includes('framing')));
});

test('a framing example missing its quote or explanation is held for review', () => {
  const bad: FramingSignal = {
    technique: 'x', severity: 'low', description: 'd',
    examples: [{ text: '', explanation: '', startIndex: -1, endIndex: -1 }],
  };
  const r = assembleReport(base({ framingSignals: [bad] }));
  assert.equal(r.status, 'needs_review');
});

test('a framing signal with a quote + explanation but no external source is valid', () => {
  // framing is rhetoric — evidenced by the example span itself, not an external URL
  const r = assembleReport(base({}));
  assert.equal(r.status, 'ready');
});

test('low confidence is held for review', () => {
  const r = assembleReport(base({ confidence: 0.2 }));
  assert.equal(r.status, 'needs_review');
});

test('empty claim set is held for review', () => {
  const r = assembleReport(base({ claims: [] }));
  assert.equal(r.status, 'needs_review');
});

test('a fully cited, evidenced, confident report is ready', () => {
  const r = assembleReport(base({}));
  assert.equal(r.status, 'ready');
  assert.equal(r.reasons.length, 0);
  for (const c of r.claims) assert.ok(c.citations.length > 0);
  for (const f of r.framingSignals) {
    assert.ok(f.examples.length > 0);
    for (const ex of f.examples) {
      assert.ok(ex.text.trim().length > 0);
      assert.ok(ex.explanation.trim().length > 0);
    }
  }
});
