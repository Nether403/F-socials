// Article transcript provider backed by Firecrawl (https://docs.firecrawl.dev).
// Scrapes the main content as markdown, lightly de-noises it (drops link/image
// syntax), and caps length to keep LLM cost/latency sane.

import type { RawInput } from '../types';
import type { Transcript, TranscriptProvider } from './types';

function articleText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> their text (incl. empty-text links)
    .replace(/^#{1,6}\s+/gm, '') // heading markers
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function makeFirecrawlArticle(opts: {
  apiKey: string;
  timeoutMs?: number;
  maxChars?: number;
}): TranscriptProvider {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const maxChars = opts.maxChars ?? 24000;

  return {
    async fetch(input: RawInput): Promise<Transcript> {
      const url = input.url;
      if (!url) throw new Error('No URL provided for article extraction.');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Firecrawl HTTP ${res.status}: ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
        }
        const json = (await res.json()) as any;
        const d = json?.data ?? json;
        const text = articleText(String(d?.markdown ?? '')).slice(0, maxChars);
        if (!text) throw new Error('Firecrawl returned no article content.');
        return { text, lang: d?.metadata?.language ?? 'en', title: d?.metadata?.title };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error(`Firecrawl timed out after ${timeoutMs}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
