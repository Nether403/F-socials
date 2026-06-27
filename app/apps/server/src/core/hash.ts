// Normalize an input into a stable cache key, then sha256 it.
// The hash is the cache key that lets a viral video be analyzed once and served
// to everyone afterward (product-definition §2).

import { createHash } from 'node:crypto';
import type { RawInput } from '../types';

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'igshid', 'si', 'feature',
]);

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(p)) u.searchParams.delete(p);
    }
    u.searchParams.sort();
    // ponytail: keeps youtube ?v= and similar meaningful params; does not canonicalize
    // youtu.be short links or playlist variants. Good enough for v1 dedupe.
    return u.toString();
  } catch {
    return raw.trim();
  }
}

export function cacheKey(input: RawInput): string {
  const basis =
    input.sourceType === 'transcript'
      ? `transcript:${(input.transcript ?? '').trim()}`
      : `${input.sourceType}:${normalizeUrl(input.url ?? '')}`;
  return createHash('sha256').update(basis).digest('hex');
}
