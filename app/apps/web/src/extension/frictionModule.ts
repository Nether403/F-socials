/**
 * Extension friction module — pure logic for the Feed Friction Dial.
 * DOM rendering is handled separately (task 6.3).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type Intensity = 'subtle' | 'moderate' | 'interruptive';

// ─── normalizeFeedUrl ────────────────────────────────────────────────────────
// Mirrors the server's content-hash normalization (core/hash.ts normalizeUrl):
// strips tracking params, removes www., lowercases host, removes hash, sorts params.

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'igshid', 'si', 'feature',
]);

export function normalizeFeedUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.hash = '';
    for (const p of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(p)) u.searchParams.delete(p);
    }
    u.searchParams.sort();
    return u.toString();
  } catch {
    return raw.trim();
  }
}

// ─── resolveIntensity ────────────────────────────────────────────────────────
// Pure, total. Returns a valid Intensity member; default 'moderate' for null/unknown/error.

const VALID_INTENSITIES: ReadonlySet<string> = new Set(['subtle', 'moderate', 'interruptive']);

export function resolveIntensity(stored: string | null): Intensity {
  if (stored !== null && VALID_INTENSITIES.has(stored)) return stored as Intensity;
  return 'moderate';
}

// ─── intensityStore ──────────────────────────────────────────────────────────
// Persists to chrome.storage.local when available; in-memory 'moderate' fallback.

const STORAGE_KEY = 'f_socials_intensity';

type Listener = (v: Intensity) => void;

function createIntensityStore() {
  let memoryFallback: Intensity = 'moderate';
  const listeners = new Set<Listener>();

  function hasChromeStorage(): boolean {
    try {
      return (
        typeof globalThis !== 'undefined' &&
        typeof (globalThis as any).chrome !== 'undefined' &&
        (globalThis as any).chrome?.storage?.local != null
      );
    } catch {
      return false;
    }
  }

  function notify(v: Intensity) {
    for (const cb of listeners) {
      try { cb(v); } catch { /* subscriber errors must not propagate */ }
    }
  }

  async function get(): Promise<Intensity> {
    if (!hasChromeStorage()) return memoryFallback;
    try {
      const result = await (globalThis as any).chrome.storage.local.get(STORAGE_KEY);
      return resolveIntensity(result?.[STORAGE_KEY] ?? null);
    } catch {
      return memoryFallback;
    }
  }

  async function set(v: Intensity): Promise<void> {
    // Always validate — even if chrome.storage is missing, update in-memory.
    const resolved = resolveIntensity(v);
    memoryFallback = resolved;
    if (hasChromeStorage()) {
      try {
        await (globalThis as any).chrome.storage.local.set({ [STORAGE_KEY]: resolved });
      } catch {
        // Storage unavailable — in-memory fallback already set.
      }
    }
    notify(resolved);
  }

  function subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }

  return { get, set, subscribe };
}

export const intensityStore = createIntensityStore();
