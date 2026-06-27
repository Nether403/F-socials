// Bridging-perspective provider (concept §6.5): Tavily finds same-topic coverage,
// Gemini scores each candidate's divergence + dehumanization and labels its issue-frame,
// then a pure filter keeps the "bridging band" — moderately divergent, low dehumanization.
//
// This deliberately avoids both echo (near-zero divergence) and bad-faith "both sides"
// (max divergence / high dehumanization). No embeddings needed — Tavily handles topic
// match, Gemini handles the framing judgment with the rule in the prompt.

import type { PerspectiveLink } from '../types';
import type { PerspectiveProvider } from './types';
import { type GeminiOpts, callGeminiJson } from './gemini';
import { classifyTier, hostOf, tavilySearch } from './tavily';

// ponytail: social platforms aren't "perspectives" — exclude obvious ones so a viral
// post doesn't get surfaced as a credible angle. Not exhaustive; extend as needed.
const SOCIAL_DOMAINS = [
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 't.co',
  'tiktok.com', 'threads.net', 'pinterest.com',
];
function isSocial(url: string): boolean {
  const h = hostOf(url);
  return SOCIAL_DOMAINS.some((d) => h === d || h.endsWith('.' + d));
}

// The bridging band. Exported for the unit test.
export const DIVERGENCE_MIN = 0.2;
export const DIVERGENCE_MAX = 0.85;
export const DEHUMANIZATION_MAX = 0.5;

export interface ScoredPerspective {
  url: string;
  issueFrameLabel: string;
  divergence: number;
  dehumanization: number;
  whyIncluded: string;
}

// Pure: keep only candidates inside the bridging band.
export function filterBridging(items: ScoredPerspective[]): ScoredPerspective[] {
  return items.filter(
    (p) =>
      typeof p.divergence === 'number' &&
      typeof p.dehumanization === 'number' &&
      p.dehumanization <= DEHUMANIZATION_MAX &&
      p.divergence >= DIVERGENCE_MIN &&
      p.divergence <= DIVERGENCE_MAX,
  );
}

const SYSTEM = `You select BRIDGING perspectives for a reader who just consumed content on a topic.
The goal is to broaden them WITHOUT triggering defensiveness.

From the candidate sources (only these — never invent URLs), choose those that are:
- on the SAME topic,
- from credible, accountable sources,
- MODERATELY divergent in viewpoint (not identical to the original, not maximally opposed or extreme),
- LOW in dehumanizing or contemptuous rhetoric.

For each candidate you assess, return:
- url (exactly as given),
- issueFrameLabel: a short neutral descriptor (e.g. "market-oriented", "institutional", "environmental", "rights-focused", "security-focused"),
- divergence: 0 = identical framing to the original, 1 = maximally opposed/extreme,
- dehumanization: 0 = none, 1 = severe contempt/dehumanization,
- whyIncluded: one calm sentence on what perspective it adds.

Return up to 8 assessed candidates; the system filters them to a bridging band afterwards.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    perspectives: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          url: { type: 'STRING' },
          issueFrameLabel: { type: 'STRING' },
          divergence: { type: 'NUMBER' },
          dehumanization: { type: 'NUMBER' },
          whyIncluded: { type: 'STRING' },
        },
        required: ['url', 'issueFrameLabel', 'divergence', 'dehumanization', 'whyIncluded'],
      },
    },
  },
  required: ['perspectives'],
};

export function makeBridgingPerspective(opts: {
  tavilyApiKey: string;
  gemini: GeminiOpts;
  maxResults?: number;
}): PerspectiveProvider {
  const maxKeep = opts.maxResults ?? 5;
  return {
    async find(topic: string): Promise<PerspectiveLink[]> {
      const raw = await tavilySearch(opts.tavilyApiKey, topic, { maxResults: 10 });
      const candidates = raw.filter((c) => c.url && !isSocial(c.url)); // drop social posts
      if (candidates.length === 0) return [];

      const userText = JSON.stringify({
        topic,
        candidates: candidates.map((c) => ({ url: c.url, title: c.title, snippet: (c.content ?? '').slice(0, 300) })),
      });

      let scored: ScoredPerspective[] = [];
      try {
        const parsed = await callGeminiJson(opts.gemini, { system: SYSTEM, userText, schema: SCHEMA });
        scored = Array.isArray(parsed?.perspectives) ? parsed.perspectives : [];
      } catch (err) {
        console.warn(`[perspective] gemini scoring failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }

      // Only keep URLs Tavily actually returned (guard against fabricated links).
      const allowed = new Set(candidates.map((c) => c.url));
      const kept = filterBridging(scored)
        .filter((p) => allowed.has(p.url))
        .slice(0, maxKeep);

      return kept.map((p) => ({
        url: p.url,
        sourceName: hostOf(p.url),
        sourceTier: classifyTier(p.url),
        issueFrameLabel: p.issueFrameLabel,
        divergence: p.divergence,
        dehumanization: p.dehumanization,
        whyIncluded: p.whyIncluded,
      }));
    },
  };
}
