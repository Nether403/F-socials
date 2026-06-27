// Evidence provider backed by GDELT DOC 2.0 (https://api.gdeltproject.org) — keyless,
// global news coverage. Sits between Fact Check (authoritative) and Tavily (broad web)
// in the evidence chain. Lens, not judge: articles are surfaced as citations.

import type { Citation, EvidenceStrength } from '../types';
import type { EvidenceProvider } from './types';
import { classifyTier, hostOf } from './tavily';

const ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

function strengthFromCount(n: number): EvidenceStrength {
  if (n === 0) return 'none';
  if (n === 1) return 'weak';
  return 'moderate';
}

export function makeGdeltEvidence(opts?: { timeoutMs?: number; maxCitations?: number }): EvidenceProvider {
  const timeoutMs = opts?.timeoutMs ?? 12000;
  const maxCitations = opts?.maxCitations ?? 3;

  return {
    async gather(claimText: string) {
      // GDELT does keyword search; trim to the most salient words.
      const query = claimText.split(/\s+/).slice(0, 12).join(' ').slice(0, 220);
      const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=10&sort=hybridrel`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'f-socials/0.1' }, signal: controller.signal });
        if (!res.ok) {
          console.warn(`[gdelt] HTTP ${res.status}`);
          return { evidenceStrength: 'none', citations: [] };
        }
        // GDELT sometimes returns non-JSON on bad queries; guard the parse.
        const body = await res.text();
        let articles: any[] = [];
        try {
          articles = JSON.parse(body)?.articles ?? [];
        } catch {
          return { evidenceStrength: 'none', citations: [] };
        }

        const seen = new Set<string>();
        const citations: Citation[] = [];
        for (const a of articles) {
          if (!a?.url || seen.has(a.url)) continue;
          seen.add(a.url);
          citations.push({
            sourceUrl: a.url,
            sourceName: a.domain ?? hostOf(a.url),
            sourceTier: classifyTier(a.url),
            excerpt: String(a.title ?? '').slice(0, 160),
            supports: null,
          });
          if (citations.length >= maxCitations) break;
        }
        return { evidenceStrength: strengthFromCount(citations.length), citations };
      } catch (err) {
        const label = err instanceof Error && err.name === 'AbortError' ? 'timed out' : (err instanceof Error ? err.message : String(err));
        console.warn(`[gdelt] lookup failed: ${label}`);
        return { evidenceStrength: 'none', citations: [] };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
