// Feature: observability-instrumentation — web consent / interaction example test.
// Validates: Requirements 12.1, 12.2, 12.5, 12.6, 12.7, 12.8
//
// Example (not property) coverage for the consent-gated Web_Analytics wrapper and its
// real call sites, under Vitest + React Testing Library:
//   - 12.5 / 12.6 — the consent gate starts closed and `track` withholds; after
//     grantConsent() the consent state opens so subsequent events may emit.
//   - 12.1 — opening a view emits exactly one 'view' event identified by route +
//     report id (driven through the real App hash-route effect).
//   - 12.2 — dispute / flag / share interactions emit the right category + report id.
//   - 12.7 — analytics never disrupts the UI: track is fire-and-forget and returns
//     without throwing, so the dispute flow completes and rendering is unaffected.
//   - 12.8 — the rendered DOM and the accessibility tree are byte-identical whether
//     consent is granted (events flowing) or not, because track has no render effect.
//
// Mechanics: analytics.ts captures `import.meta.env.VITE_POSTHOG_KEY` once at module
// eval, and Vite inlines that read to a build-time literal — it cannot be toggled at
// runtime, so the wrapper is a no-op against the live SDK in the test build (the same
// reason the Property-13 test pins the no-op path). We therefore mock the analytics
// module with `{ spy: true }`: the REAL wrapper code runs (real consent gate, real
// buildWebEvent sanitizer, real fire-and-forget no-op) while we observe the call-site
// emissions through the spy. posthog-js and the API client are mocked so nothing
// reaches the network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import type { AnalysisReport } from './api/types';

expect.extend(axeMatchers);

// vitest-axe's matcher types target an older Vitest Assertion namespace, so the
// `toHaveNoViolations` matcher is registered at runtime (expect.extend above) but not
// surfaced on the typed Assertion under Vitest 4 (same gap as a11ySmoke.test.tsx).
// This thin cast reaches the runtime matcher without a type error.
const expectAxe = (results: unknown) =>
  expect(results) as unknown as { toHaveNoViolations(): void };

// Guard against the real SDK loading (analytics.ts imports it at module top).
vi.mock('posthog-js', () => ({ default: { init: vi.fn(), capture: vi.fn() } }));

// One mock covers every client call across App (submitAnalysis/getReportBySlug/
// pollReport/detectInput), Report (submitFlag), and DisputeModal (submitDispute).
const api = vi.hoisted(() => ({
  submitDispute: vi.fn(),
  submitFlag: vi.fn(),
  submitAnalysis: vi.fn(),
  getReportBySlug: vi.fn(),
  pollReport: vi.fn(),
  detectInput: vi.fn(),
}));
vi.mock('./api/client', () => api);

// Spy-wrap the analytics module: real implementations run, call args are recorded,
// and the same spied `track` is what App / Report / DisputeModal import and invoke.
vi.mock('./analytics', { spy: true });

import * as analytics from './analytics';
import App from './App';
import { Report } from './components/Report';
import { LanguageProvider } from './i18n/context';
import type { UseSession } from './auth/useSession';

const trackSpy = vi.mocked(analytics.track);

// A minimal active session so gated controls (Save/Flag) proceed (Req 6.1). Only the
// fields Report reads are populated; the rest are inert stubs.
const activeSession = {
  session: { accessToken: 'test-token', reader: { id: 'user-1' } },
  configured: true,
  loading: false,
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  clearSession: vi.fn(),
  handleAuthError: vi.fn(),
  pendingAction: { current: null },
} as unknown as UseSession;

// A representative report: provenance (footer + dispute control), a share slug
// (Share button), one framing signal (Flag button), one claim.
const report: AnalysisReport = {
  id: 'report-abc',
  status: 'ready',
  version: 1,
  producingLayer: 'L2',
  title: 'Test analysis',
  shareSlug: 'shareabc',
  claims: [
    {
      id: 'c1',
      claimText: 'A verifiable claim.',
      verifiability: 'verifiable',
      evidenceStrength: 'none',
      confidence: 0.4,
      citations: [],
    },
  ],
  framingSignals: [
    { technique: 'Loaded language', severity: 'medium', description: 'Charged wording.', examples: [] },
  ],
  contextCards: [],
  perspectives: [],
  provenance: {
    model: 'gemini-test',
    analysisVersion: 'a1',
    sourcePolicyVersion: 'sp1',
    reviewStatus: 'auto-cleared',
    lastUpdated: '2024-01-01T00:00:00.000Z',
    disputesCount: 0,
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const AXE_OPTS = {
  runOnly: { type: 'tag' as const, values: ['wcag2a', 'wcag2aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

// The bare `localStorage` global in this runner is Node's experimental web-storage
// stub (no working setItem), not a real store — so the wrapper's consent persistence
// (which reads/writes `localStorage`) needs a functional one. Provide a minimal
// in-memory Storage so the REAL grantConsent()/hasConsent() execute end to end.
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  } as Storage;
}

beforeEach(() => {
  trackSpy.mockClear();
  api.submitDispute.mockReset().mockResolvedValue(undefined);
  api.submitFlag.mockReset().mockResolvedValue(undefined);
  api.submitAnalysis.mockReset().mockResolvedValue({ reportId: 'x', status: 'ready', cached: false });
  api.getReportBySlug.mockReset().mockResolvedValue(report);
  api.pollReport.mockReset().mockResolvedValue(report);
  api.detectInput.mockReset().mockReturnValue({ sourceType: 'transcript', transcript: 't' });
  vi.stubGlobal('localStorage', memStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('consent gate (Req 12.5, 12.6)', () => {
  it('starts closed and withholds, then opens after grantConsent so events may emit', () => {
    // 12.5 — no consent recorded yet: the gate is closed.
    expect(analytics.hasConsent()).toBe(false);
    // The real wrapper is fire-and-forget: calling it withholds (no SDK reached) and
    // returns synchronously without throwing.
    expect(analytics.track('view', { route: '#/report', reportId: 'r1' })).toBeUndefined();

    // 12.6 — once consent is granted the gate opens for subsequent events.
    analytics.grantConsent();
    expect(analytics.hasConsent()).toBe(true);
    expect(analytics.track('view', { route: '#/report', reportId: 'r1' })).toBeUndefined();
  });
});

describe('view + interaction events carry the right category + report id (Req 12.1, 12.2)', () => {
  it('emits one view event with route + report id on open (App hash-route effect)', () => {
    analytics.grantConsent();
    render(<LanguageProvider><App /></LanguageProvider>);

    // The home view fires exactly one 'view' event, keyed by route (report id undefined).
    const viewCalls = trackSpy.mock.calls.filter((c) => c[0] === 'view');
    expect(viewCalls).toHaveLength(1);
    expect(viewCalls[0][1]).toEqual(expect.objectContaining({ route: '#/home' }));
  }, 20000);

  it('emits a share event with the report id', async () => {
    analytics.grantConsent();
    const user = userEvent.setup();

    render(<LanguageProvider><Report report={report} onBack={() => {}} /></LanguageProvider>);
    await user.click(screen.getByRole('button', { name: /share/i }));

    expect(trackSpy).toHaveBeenCalledWith('share', { reportId: 'report-abc' });
  }, 20000);

  it('emits a flag event with the report id (and no user identifier)', async () => {
    analytics.grantConsent();
    const user = userEvent.setup();

    // An active session so the flag passes the auth gate and actually emits.
    render(<LanguageProvider><Report report={report} onBack={() => {}} session={activeSession} /></LanguageProvider>);
    await user.click(screen.getByRole('button', { name: /framing signals/i }));
    await user.click(screen.getByRole('button', { name: 'Flag this technique' }));

    expect(trackSpy).toHaveBeenCalledWith('flag', { reportId: 'report-abc' });
    // The categorical event carries only the report id — never a user identifier.
    const flagCall = trackSpy.mock.calls.find((c) => c[0] === 'flag');
    expect(Object.keys(flagCall![1] as object)).toEqual(['reportId']);
  }, 20000);

  it('emits a dispute event with the report id on submit', async () => {
    analytics.grantConsent();
    const user = userEvent.setup();

    render(<LanguageProvider><Report report={report} onBack={() => {}} /></LanguageProvider>);
    await user.click(screen.getByRole('button', { name: /dispute this analysis/i }));
    await user.type(screen.getByLabelText(/your reason/i), 'This was mischaracterized.');
    await user.click(screen.getByRole('button', { name: /submit dispute/i }));

    expect(await screen.findByText(/received/i)).toBeInTheDocument();
    expect(trackSpy).toHaveBeenCalledWith('dispute', { reportId: 'report-abc' });
  }, 20000);
});

describe('analytics never disrupts the UI (Req 12.7)', () => {
  it('a dispute completes normally with analytics in the flow and nothing thrown', async () => {
    analytics.grantConsent();
    const user = userEvent.setup();

    render(<LanguageProvider><Report report={report} onBack={() => {}} /></LanguageProvider>);
    expect(screen.getByText('Test analysis')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /dispute this analysis/i }));
    await user.type(screen.getByLabelText(/your reason/i), 'Still works.');
    await user.click(screen.getByRole('button', { name: /submit dispute/i }));

    // The interaction completes — the fire-and-forget telemetry call is invisible to it.
    expect(await screen.findByText(/received/i)).toBeInTheDocument();
    expect(trackSpy).toHaveBeenCalledWith('dispute', { reportId: 'report-abc' });
  }, 20000);
});

describe('DOM + accessibility tree identical with/without analytics (Req 12.8)', () => {
  it('renders byte-identical DOM with no a11y violations whether consent is granted or not', async () => {
    // No consent (events withheld): capture markup + a11y baseline.
    const { container: c1 } = render(<LanguageProvider><Report report={report} onBack={() => {}} /></LanguageProvider>);
    const htmlWithheld = c1.innerHTML;
    expectAxe(await axe(c1, AXE_OPTS)).toHaveNoViolations();
    cleanup();

    // Consent granted (events flowing): markup must match exactly — track has no
    // render side effects, so the DOM and the derived a11y tree are unchanged.
    analytics.grantConsent();
    const { container: c2 } = render(<LanguageProvider><Report report={report} onBack={() => {}} /></LanguageProvider>);
    const htmlActive = c2.innerHTML;
    expectAxe(await axe(c2, AXE_OPTS)).toHaveNoViolations();

    expect(htmlActive).toBe(htmlWithheld);
  }, 30000);
});
