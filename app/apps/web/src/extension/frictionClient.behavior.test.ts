/**
 * Behavior + property tests for the Extension friction client (`frictionClient.ts`).
 *
 * Property 10: Friction client renders nothing on any non-success outcome and never
 * triggers analysis. `fetchOverlay` resolves to `null` for every non-200 outcome
 * (HTTP 4xx/5xx — incl. 404 and 503 —, network error, or >5s timeout) and the client
 * issues ONLY the read-only friction GET, never a `POST /analyses`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { fetchOverlay, _resetGateState } from './frictionClient';

const NUM_RUNS = 100;

// ─── Fake Response factory ───────────────────────────────────────────────────

function makeResponse(status: number, body: unknown = { reportId: 'x', framingSignals: [], evidenceSummary: [], reportUrl: 'u' }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

// A detected feed URL (arbitrary http(s) URL the content script would hand the client).
const arbFeedUrl = fc.webUrl();

// Non-success status codes: everything outside the 2xx success band.
const arbNonSuccessStatus = fc.oneof(
  fc.constantFrom(400, 401, 403, 404, 408, 409, 410, 418, 429, 500, 502, 503, 504),
  fc.integer({ min: 300, max: 599 }),
);

// An outcome is either a non-success HTTP status or a thrown network error.
const arbNonSuccessOutcome = fc.oneof(
  arbNonSuccessStatus.map((status) => ({ kind: 'status' as const, status })),
  fc.constant({ kind: 'network' as const }),
);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  _resetGateState();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  _resetGateState();
});

describe('Property 10: Friction client renders nothing on any non-success outcome and never triggers analysis', () => {
  // Feature: intervention-and-scale, Property 10: Friction client renders nothing on any non-success outcome and never triggers analysis
  // Validates: Requirements 2.7, 5.2, 5.3, 5.6

  it('resolves to null for every non-200 outcome (HTTP error or network error)', async () => {
    await fc.assert(
      fc.asyncProperty(arbFeedUrl, arbNonSuccessOutcome, async (url, outcome) => {
        // Reset gate-dark throttle so each generated case actually issues a fetch.
        _resetGateState();
        if (outcome.kind === 'status') {
          fetchMock.mockResolvedValueOnce(makeResponse(outcome.status));
        } else {
          fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        }

        const result = await fetchOverlay(url);
        // Non-success => render nothing, no overlay data, no error indicator surfaced.
        expect(result).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('only ever issues a read-only GET to /api/v1/friction — never a POST and never /analyses', async () => {
    await fc.assert(
      fc.asyncProperty(arbFeedUrl, arbNonSuccessOutcome, async (url, outcome) => {
        _resetGateState();
        fetchMock.mockReset();
        if (outcome.kind === 'status') {
          fetchMock.mockResolvedValueOnce(makeResponse(outcome.status));
        } else {
          fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        }

        await fetchOverlay(url);

        // Every fetch the client made targets the read-only friction endpoint with a
        // GET (no explicit method => GET), and nothing touches the write /analyses path.
        for (const call of fetchMock.mock.calls) {
          const [reqUrl, init] = call as [string, RequestInit | undefined];
          expect(reqUrl).toContain('/api/v1/friction');
          expect(reqUrl).not.toContain('/analyses');
          const method = (init?.method ?? 'GET').toUpperCase();
          expect(method).toBe('GET');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a 200 overlay is the ONLY success path (returns the parsed payload)', async () => {
    await fc.assert(
      fc.asyncProperty(arbFeedUrl, async (url) => {
        _resetGateState();
        const payload = { reportId: 'rep_1', framingSignals: [], evidenceSummary: [], reportUrl: 'https://x/r/1' };
        fetchMock.mockReset();
        fetchMock.mockResolvedValueOnce(makeResponse(200, payload));

        const result = await fetchOverlay(url);
        expect(result).toEqual(payload);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 10 (timeout): a request that never resolves yields null after the 5s budget', () => {
  // Feature: intervention-and-scale, Property 10: Friction client renders nothing on any non-success outcome and never triggers analysis
  // Validates: Requirements 2.7, 5.2

  it('aborts and resolves null when fetch never resolves within 5 seconds', async () => {
    vi.useFakeTimers();
    _resetGateState();

    // fetch that never resolves on its own — only the client's AbortController can end it.
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
    );

    const pending = fetchOverlay('https://example.com/feed/item');

    // Drive the client's 5s abort timer; the abort rejects the in-flight fetch.
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toBeNull();
    // The client still issued exactly one read-only GET (it never POSTs to /analyses).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/friction');
  });
});
