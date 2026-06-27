// Mock providers so the whole pipeline runs offline with zero API keys.
// ponytail: these are deterministic stand-ins, not real analysis. Swap each for a
// real provider (see f-Socials-resources-shopping-list.md) — the interface is the contract.

import type {
  EvidenceProvider,
  ExtractionResult,
  LLMProvider,
  PerspectiveProvider,
  Transcript,
  TranscriptProvider,
} from './types';
import type { RawInput } from '../types';

export const passthroughTranscript: TranscriptProvider = {
  async fetch(input: RawInput): Promise<Transcript> {
    if (input.sourceType === 'transcript') {
      return { text: (input.transcript ?? '').trim(), lang: 'en' };
    }
    // ponytail: no real fetch yet for youtube/article — return a placeholder so the
    // pipeline is exercisable. Real TranscriptProvider needed before these are useful.
    return {
      text: `[mock transcript for ${input.url ?? 'unknown source'}]`,
      lang: 'en',
      title: input.url,
    };
  },
};

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const OUTRAGE = /(always|never|everyone|nobody|destroy|disaster|outrage|shocking|!{2,})/i;

export const mockLLM: LLMProvider = {
  async extract(transcript: Transcript): Promise<ExtractionResult> {
    const sentences = splitSentences(transcript.text);
    const claimSentences = sentences.slice(0, 5);

    const claims = claimSentences.map((s) => {
      const factual = /\d|percent|%|study|report|data/i.test(s);
      return {
        claimText: s,
        transcriptSpan: s,
        verifiability: factual ? ('verifiable' as const) : ('opinion' as const),
        confidence: factual ? 0.7 : 0.5,
      };
    });

    const framingSignals = sentences
      .filter((s) => OUTRAGE.test(s))
      .slice(0, 3)
      .map((s) => ({
        technique: 'Emotional Language',
        severity: 'medium' as const,
        description: '(mock) high-arousal wording that primes the reader before the argument.',
        examples: [{ text: s, explanation: '(mock) emotionally charged phrasing.' }],
      }));

    return {
      tldr: sentences.slice(0, 2).join(' ') || '(empty input)',
      issueFrame: { label: 'mixed', x: 0, y: 0 },
      claims,
      framingSignals,
      contextCards: [],
    };
  },
};

export const mockEvidence: EvidenceProvider = {
  async gather(claimText: string) {
    return {
      evidenceStrength: 'moderate' as const,
      citations: [
        {
          sourceUrl: 'https://example.org/mock-source',
          sourceName: 'Mock Institutional Source',
          sourceTier: 'tier2_institutional' as const,
          excerpt: `Context relevant to: ${claimText.slice(0, 60)}`,
          supports: null,
        },
      ],
    };
  },
};

export const mockPerspective: PerspectiveProvider = {
  async find(topic: string) {
    return [
      {
        url: 'https://example.org/perspective-a',
        sourceName: 'Source A',
        sourceTier: 'tier2_institutional' as const,
        issueFrameLabel: 'institutional',
        divergence: 0.4,
        dehumanization: 0.05,
      },
      {
        url: 'https://example.org/perspective-b',
        sourceName: 'Source B',
        sourceTier: 'tier2_institutional' as const,
        issueFrameLabel: 'market-oriented',
        divergence: 0.5,
        dehumanization: 0.04,
      },
    ];
  },
};
