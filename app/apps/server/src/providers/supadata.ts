// Transcript provider backed by Supadata (https://supadata.ai).
// Returns transcripts even when YouTube blocks server-side caption fetches.
// Prefers English; falls back to the video's default track if there's no en.

import type { RawInput } from '../types';
import type { Transcript, TranscriptProvider } from './types';

const ENDPOINT = 'https://api.supadata.ai/v1/youtube/transcript';

function toText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: any) => c?.text ?? '').join(' ');
  return '';
}
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function makeSupadataTranscript(opts: {
  apiKey: string;
  timeoutMs?: number;
  preferLang?: string;
}): TranscriptProvider {
  const timeoutMs = opts.timeoutMs ?? 25000;
  const preferLang = opts.preferLang ?? 'en';

  async function call(url: string, lang?: string): Promise<any> {
    const q = new URLSearchParams({ text: 'true', url });
    if (lang) q.set('lang', lang);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${ENDPOINT}?${q}`, {
        headers: { 'x-api-key': opts.apiKey },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Supadata HTTP ${res.status}: ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async fetch(input: RawInput): Promise<Transcript> {
      const url = input.url;
      if (!url) throw new Error('No URL provided for Supadata transcript.');

      let data: any;
      let text = '';
      try {
        data = await call(url, preferLang);
        text = clean(toText(data?.content));
      } catch {
        // preferred language may not exist for this video — fall back to default below
      }
      if (!text) {
        data = await call(url); // no lang = video's default track
        text = clean(toText(data?.content));
      }
      if (!text) throw new Error('Supadata returned no transcript content.');

      return { text, lang: data?.lang ?? preferLang };
    },
  };
}
