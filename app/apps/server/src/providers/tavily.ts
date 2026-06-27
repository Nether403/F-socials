// Tavily search (https://docs.tavily.com) — shared by the evidence provider and the
// bridging-perspective provider. Lens, not judge: results are surfaced as citations
// (supports: null); we never treat Tavily's synthesized answer as our verdict.

import type { Citation, EvidenceStrength, SourceTier } from '../types';
import type { EvidenceProvider } from './types';

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export async function tavilySearch(
  apiKey: string,
  query: string,
  opts?: { maxResults?: number; timeoutMs?: number },
): Promise<TavilyResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15000);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: query.slice(0, 400),
        max_results: opts?.maxResults ?? 5,
        search_depth: 'basic',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[tavily] HTTP ${res.status}: ${body.slice(0, 150).replace(/\s+/g, ' ')}`);
      return [];
    }
    const data = (await res.json()) as any;
    return Array.isArray(data?.results) ? (data.results as TavilyResult[]) : [];
  } catch (err) {
    const label = err instanceof Error && err.name === 'AbortError' ? 'timed out' : (err instanceof Error ? err.message : String(err));
    console.warn(`[tavily] search failed: ${label}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ponytail: naive institutional allowlist. Ceiling: a random blog on a covered TLD
// still reads as tier3. Upgrade path: a real source-reliability dataset (MBFC / Ad Fontes).
const INSTITUTIONAL = [
  'factcheck.org', 'politifact.com', 'snopes.com', 'apnews.com', 'reuters.com',
  'bbc.com', 'bbc.co.uk', 'nature.com', 'science.org', 'mayoclinic.org',
  'who.int', 'un.org', 'nasa.gov', 'noaa.gov',
];

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

export function classifyTier(url: string): SourceTier {
  const h = hostOf(url);
  if (h.endsWith('.gov') || h.endsWith('.edu') || h.endsWith('.gov.uk') || h.endsWith('.ac.uk')) {
    return 'tier2_institutional';
  }
  if (INSTITUTIONAL.some((d) => h === d || h.endsWith('.' + d))) return 'tier2_institutional';
  return 'tier3_viewpoint';
}

function strengthFromCount(n: number): EvidenceStrength {
  if (n === 0) return 'none';
  if (n === 1) return 'weak';
  return 'moderate';
}

export function makeTavilyEvidence(opts: {
  apiKey: string;
  timeoutMs?: number;
  maxCitations?: number;
}): EvidenceProvider {
  const maxCitations = opts.maxCitations ?? 3;
  return {
    async gather(claimText: string) {
      const results = await tavilySearch(opts.apiKey, claimText, {
        maxResults: Math.max(maxCitations, 5),
        timeoutMs: opts.timeoutMs,
      });
      const citations: Citation[] = results
        .filter((r) => r?.url)
        .slice(0, maxCitations)
        .map((r) => ({
          sourceUrl: r.url,
          sourceName: hostOf(r.url),
          sourceTier: classifyTier(r.url),
          excerpt: String(r.title ?? '').slice(0, 160),
          supports: null,
        }));
      return { evidenceStrength: strengthFromCount(citations.length), citations };
    },
  };
}
