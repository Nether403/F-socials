// Evidence provider backed by the Google Fact Check Tools API (claims:search).
// Docs: https://developers.google.com/fact-check/tools/api
//
// Lens, not judge: we surface what *other* fact-checkers said (publisher + their
// textual rating) as citations. We do NOT convert their rating into our own verdict
// (supports stays null). evidenceStrength reflects HOW MUCH external review exists,
// never whether the claim is "true".

import type { Citation, EvidenceStrength } from '../types';
import type { EvidenceProvider } from './types';

const ENDPOINT = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';

function strengthFromCount(n: number): EvidenceStrength {
  if (n === 0) return 'none';
  if (n === 1) return 'weak';
  // ponytail: keyword-matched fact-checks aren't guaranteed to be about the EXACT
  // claim, so we never auto-promote to 'strong'. A human/expert can upgrade later.
  return 'moderate';
}

function buildExcerpt(title?: string, rating?: string): string {
  const bits: string[] = [];
  if (title) bits.push(title);
  if (rating) bits.push(`rated "${rating}"`);
  return bits.join(' — ') || 'Fact-check review';
}

export function makeGoogleFactCheckEvidence(opts: {
  apiKey: string;
  timeoutMs?: number;
  maxCitations?: number;
}): EvidenceProvider {
  const timeoutMs = opts.timeoutMs ?? 12000;
  const maxCitations = opts.maxCitations ?? 3;

  return {
    async gather(claimText: string) {
      const url = `${ENDPOINT}?languageCode=en&pageSize=10&query=${encodeURIComponent(claimText.slice(0, 300))}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          headers: { 'x-goog-api-key': opts.apiKey },
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text();
          console.warn(
            `[factcheck] HTTP ${res.status} for "${claimText.slice(0, 50)}...": ${body.slice(0, 150).replace(/\s+/g, ' ')}`,
          );
          return { evidenceStrength: 'none', citations: [] };
        }

        const data = (await res.json()) as any;
        const claims: any[] = Array.isArray(data?.claims) ? data.claims : [];

        const citations: Citation[] = [];
        for (const c of claims) {
          for (const review of c.claimReview ?? []) {
            if (!review?.url) continue;
            citations.push({
              sourceUrl: review.url,
              sourceName: review.publisher?.name ?? review.publisher?.site ?? 'Fact-checker',
              sourceTier: 'tier2_institutional',
              excerpt: buildExcerpt(review.title, review.textualRating),
              supports: null,
            });
            if (citations.length >= maxCitations) break;
          }
          if (citations.length >= maxCitations) break;
        }

        return { evidenceStrength: strengthFromCount(citations.length), citations };
      } catch (err) {
        const label =
          err instanceof Error && err.name === 'AbortError'
            ? `timed out after ${timeoutMs}ms`
            : err instanceof Error
              ? err.message
              : String(err);
        console.warn(`[factcheck] lookup failed for "${claimText.slice(0, 50)}...": ${label}`);
        return { evidenceStrength: 'none', citations: [] };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
