// YouTube transcript provider — pulls captions + title from the watch page's
// ytInitialPlayerResponse (no API key needed). Title also comes from there.
//
// ponytail: watch-page extraction is inherently brittle — YouTube changes page shape
// and rate-limits datacenter IPs. Ceiling: may fail from cloud/sandbox IPs or for
// videos without captions. On failure we throw a clear, actionable error and the
// user can paste the transcript instead. Upgrade path: Supadata / a maintained
// InnerTube client, or audio download -> Deepgram.

import type { RawInput } from '../types';
import type { Transcript, TranscriptProvider } from './types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com' || host === 'm.youtube.com' || host.endsWith('.youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:shorts|embed|v|live)\/([^/?]+)/);
      if (m) return m[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

// Brace-balanced extraction of the JSON object following a marker (robust to nesting).
function extractJsonAfter(html: string, marker: string): any | null {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  if (!tracks.length) return undefined;
  const en = tracks.filter((t) => t.languageCode?.startsWith('en'));
  return en.find((t) => t.kind !== 'asr') ?? en[0] ?? tracks[0];
}

async function getText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        'accept-language': 'en-US,en;q=0.9',
        cookie: 'CONSENT=YES+1; SOCS=CAI', // skip EU consent interstitial
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function makeYouTubeTranscript(opts?: { timeoutMs?: number }): TranscriptProvider {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  return {
    async fetch(input: RawInput): Promise<Transcript> {
      const id = extractVideoId(input.url ?? '');
      if (!id) throw new Error('Could not parse a YouTube video ID from the URL.');

      const html = await getText(`https://www.youtube.com/watch?v=${id}&hl=en`, timeoutMs);
      const player = extractJsonAfter(html, 'ytInitialPlayerResponse');
      if (!player) {
        throw new Error('Could not read YouTube player data (page shape changed or request blocked).');
      }

      const status = player?.playabilityStatus?.status;
      if (status && status !== 'OK') {
        const reason = player?.playabilityStatus?.reason ?? status;
        throw new Error(`Video not playable: ${reason}`);
      }

      const title: string | undefined = player?.videoDetails?.title;
      const tracks: CaptionTrack[] =
        player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const track = pickTrack(tracks);
      if (!track?.baseUrl) {
        throw new Error('This video has no captions available. Paste the transcript manually instead.');
      }

      const sep = track.baseUrl.includes('?') ? '&' : '?';
      const raw = await getText(`${track.baseUrl}${sep}fmt=json3`, timeoutMs);
      if (!raw.trim()) {
        // YouTube returns an empty 200 for timedtext without a proof-of-origin (pot)
        // token — a deliberate anti-bot measure affecting all simple server-side fetches.
        throw new Error(
          'YouTube withheld caption data (empty response — requires a proof-of-origin token). ' +
            'Use a transcript service (e.g. Supadata) or paste the transcript manually.',
        );
      }
      let events: any[] = [];
      try {
        events = JSON.parse(raw)?.events ?? [];
      } catch {
        throw new Error('Caption track returned an unparseable format (expected json3).');
      }

      const text = events
        .flatMap((e) => (Array.isArray(e.segs) ? e.segs.map((s: any) => s.utf8 ?? '') : []))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) throw new Error('Caption track was empty.');

      return { text, lang: track.languageCode ?? 'en', title };
    },
  };
}
