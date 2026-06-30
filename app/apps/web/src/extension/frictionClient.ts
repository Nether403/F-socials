/**
 * Extension friction client — fetches overlay data from the API.
 * Resolves null on any non-200 (404/503/network/timeout), never triggers analysis.
 * Gate-dark polling: at most every 5 minutes.
 * Reconnect: re-check viewport items within 10 seconds.
 */

import { normalizeFeedUrl } from './frictionModule';

const API = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE as string | undefined) ?? '';

// ─── Types (mirrors server's FrictionOverlayData) ────────────────────────────

export interface FrictionSignal {
  technique: string;
  severity: 'low' | 'medium' | 'high';
  quote: string;
  explanation: string;
}

export interface FrictionEvidenceItem {
  claimText: string;
  evidenceStrength: 'none' | 'weak' | 'moderate' | 'strong';
}

export interface FrictionOverlayData {
  reportId: string;
  framingSignals: FrictionSignal[];
  evidenceSummary: FrictionEvidenceItem[];
  reportUrl: string;
}

// ─── Gate-dark throttle ──────────────────────────────────────────────────────

const GATE_DARK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastGateDarkCheck = 0;
let gateDark = false;

function isGateDarkThrottled(): boolean {
  if (!gateDark) return false;
  return Date.now() - lastGateDarkCheck < GATE_DARK_INTERVAL_MS;
}

// ─── fetchOverlay ────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5_000;

/**
 * Fetch overlay data for a feed URL.
 * - Normalizes URL via normalizeFeedUrl
 * - Calls GET /api/v1/friction?url=<normalized>
 * - On 200: returns the overlay data
 * - On 404/503/network error/>5s timeout: returns null (render nothing)
 * - Never issues POST /analyses (no new analysis triggered)
 */
export async function fetchOverlay(url: string): Promise<FrictionOverlayData | null> {
  // Gate-dark throttle: don't re-check more than once per 5 min
  if (isGateDarkThrottled()) return null;

  const normalized = normalizeFeedUrl(url);
  const endpoint = `${API}/api/v1/friction?url=${encodeURIComponent(normalized)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timer);

    if (res.status === 503) {
      // Gate is dark — record timestamp for throttle
      gateDark = true;
      lastGateDarkCheck = Date.now();
      return null;
    }

    if (res.status === 404 || !res.ok) {
      return null;
    }

    // Gate was satisfied (got a 200), clear dark state
    gateDark = false;
    return (await res.json()) as FrictionOverlayData;
  } catch {
    // Network error or abort (timeout) — render nothing
    return null;
  }
}

// ─── Reconnect: re-check viewport items within 10 seconds ───────────────────

type ViewportCheckCallback = () => void;
let reconnectListeners: Set<ViewportCheckCallback> = new Set();
let wasOffline = false;

function handleOnline() {
  if (!wasOffline) return;
  wasOffline = false;
  // Re-check viewport items within 10 seconds
  const delay = Math.random() * 10_000; // spread re-checks within the window
  setTimeout(() => {
    for (const cb of reconnectListeners) {
      try { cb(); } catch { /* subscriber errors must not propagate */ }
    }
  }, delay);
}

function handleOffline() {
  wasOffline = true;
}

// Only attach browser event listeners if window is available (extension context)
if (typeof window !== 'undefined') {
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
}

/**
 * Register a callback that fires when connectivity is restored.
 * The callback should re-check any viewport feed items.
 * Returns an unsubscribe function.
 */
export function onReconnect(cb: ViewportCheckCallback): () => void {
  reconnectListeners.add(cb);
  return () => { reconnectListeners.delete(cb); };
}

// ─── Testing helpers (exported for test access) ──────────────────────────────

export function _resetGateState(): void {
  gateDark = false;
  lastGateDarkCheck = 0;
}
