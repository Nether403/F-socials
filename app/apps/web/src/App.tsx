import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { LogIn, LogOut, Bookmark, Moon, Sun, Users } from 'lucide-react';
import { detectInput, getReport, getReportBySlug, pollReport, submitAnalysis } from './api/client';
import { track } from './analytics';
import type { AnalysisReport } from './api/types';
import { Report } from './components/Report';
import { Methodology } from './components/Methodology';
import { ReviewerConsole } from './components/ReviewerConsole';
import { AuthPanel } from './components/AuthPanel';
import { HistoryView } from './components/HistoryView';
import { WorkspaceListView } from './components/WorkspaceListView';
import { WorkspaceDetailView } from './components/WorkspaceDetailView';
import { useSession } from './auth/useSession';

type View =
  | { kind: 'home' }
  | { kind: 'loading'; status: string }
  | { kind: 'report'; report: AnalysisReport; shared?: boolean }
  | { kind: 'methodology' }
  | { kind: 'review' }
  | { kind: 'sign-in' }
  | { kind: 'history' }
  | { kind: 'workspaces' }
  | { kind: 'workspace-detail'; workspaceId: string }
  | { kind: 'error'; message: string };

// Render-time guard for the Methodology page (Requirement 1.12). If the page
// throws while rendering, we show an unavailable banner instead of a blank app;
// the reader's prior report view is retained in App state and restored via onBack.
class MethodologyBoundary extends Component<
  { onBack: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Methodology page failed to render', error, info);
  }
  render() {
    if (this.state.failed) {
      return (
        <div>
          <div className="banner error">
            The methodology page is unavailable right now. Your report is still here.
          </div>
          <button className="btn btn-ghost" onClick={this.props.onBack}>
            Back
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const EXAMPLES: { label: string; blurb: string; text: string }[] = [
  {
    label: 'Deep-sea mining monologue',
    blurb: 'A persuasive clip arguing seabed mining is "impact-free".',
    text: 'We stand at a critical crossroads. Climate change is ravaging our planet, and our only escape is a complete transition to green energy. The land-based mines in Congo are hotbeds of human rights violations. Harvesting these nodules is virtually impact-free. Mining companies are being held back by radical environmentalists who care more about deep-sea worms than the future of humanity. If we do not mine the seabed now, we doom ourselves to global warming.',
  },
  {
    label: 'Conspiracy-laden rant',
    blurb: 'Mixes well-known false claims with charged rhetoric.',
    text: "Let me tell you the truth the mainstream media buries. COVID-19 vaccines contain a microchip that tracks the location of the patient. Climate change is a hoax invented by elites to control ordinary people. The moon landing in 1969 was staged in a Hollywood studio. Wake up before it is too late!",
  },
];

const STEPS = [
  'Acquiring transcript',
  'Extracting claims & framing',
  'Checking evidence',
  'Finding other perspectives',
  'Assembling report',
];

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [input, setInput] = useState('');
  const [view, setView] = useState<View>({ kind: 'home' });
  const [stepIdx, setStepIdx] = useState(0);
  // The single session instance for the whole app (Req owns one useSession): it
  // restores a persisted session on load, tracks refresh/expiry, and on a 401
  // clears the session so the app falls back to the Anonymous experience (Req 4.4).
  const session = useSession();
  // Transient header notice, e.g. the sign-out-failed warning that the remote
  // session may still be active (Req 3.5). Announced via an ARIA live region.
  const [notice, setNotice] = useState<string | null>(null);
  const stepTimer = useRef<number | undefined>(undefined);
  // Track the live view so the hash handler (a stable closure) can read it, and
  // remember the last report view to restore when the reader leaves Methodology (1.12).
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const priorReportRef = useRef<View | null>(null);
  // Remember the last attempted request so the error view's Retry can re-run it,
  // whether the failure came from a fresh analysis (run) or a shared-report load (4.2).
  const lastAttemptRef = useRef<(() => void) | null>(null);
  // The last view we emitted a 'view' analytics event for, so each distinct view
  // (route + report id) emits exactly once despite re-renders / StrictMode double-invoke.
  const lastViewKeyRef = useRef<string | null>(null);
  // Retained Workspace_View target for the post-sign-in return (Req 13.4). It holds
  // the workspace hash WHILE the reader is on a workspace route and is cleared at the
  // top of every hash resolution, so it is only ever set for the workspace route the
  // reader is currently viewing. afterAuthSuccess prefers it over the gated-report
  // pending action so an anonymous reader who opened a Workspace_View returns to it.
  const pendingWorkspaceTarget = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Hash routing: shared report (#/r/<slug>) and the no-auth Methodology page (#/methodology).
  useEffect(() => {
    async function loadFromHash() {
      const hash = window.location.hash;
      // Only retain a Workspace_View target while the reader is actually on a
      // workspace route; clearing here first keeps the ref from leaking to a later
      // sign-in started from a different surface (Req 13.4).
      pendingWorkspaceTarget.current = null;
      const shareMatch = hash.match(/^#\/r\/([A-Za-z0-9]+)/);
      if (shareMatch) {
        loadShared(shareMatch[1]);
        return;
      }
      // #/methodology serves the Methodology page without authentication (1.1, 1.11).
      if (/^#\/methodology\b/.test(hash)) {
        if (viewRef.current.kind === 'report') priorReportRef.current = viewRef.current;
        setView({ kind: 'methodology' });
        return;
      }
      // #/review serves the reviewer console (Req 11.1). Hash routing only.
      if (/^#\/review\b/.test(hash)) {
        setView({ kind: 'review' });
        return;
      }
      // #/sign-in serves the accounts surface (Req 14.1). Session-gating is done at
      // render time (the session restores asynchronously), so the hash handler just
      // selects the view.
      if (/^#\/sign-in\b/.test(hash)) {
        setView({ kind: 'sign-in' });
        return;
      }
      // #/history serves the saved-report History_View (Req 14.1). Anonymous readers
      // are redirected to the sign-in surface at render time (Req 9 gating).
      if (/^#\/history\b/.test(hash)) {
        setView({ kind: 'history' });
        return;
      }
      // #/workspaces/<id> serves a single Workspace_Detail_View; #/workspaces (no id)
      // serves the Workspace list (Req 13.1, hash routing only). Session-gating is done
      // at render time. The target hash is retained so an anonymous-but-configured
      // reader returns here after signing in (Req 13.4).
      const workspaceDetailMatch = hash.match(/^#\/workspaces\/([^/?#]+)/);
      if (workspaceDetailMatch) {
        pendingWorkspaceTarget.current = hash;
        setView({ kind: 'workspace-detail', workspaceId: decodeURIComponent(workspaceDetailMatch[1]) });
        return;
      }
      if (/^#\/workspaces\b/.test(hash)) {
        pendingWorkspaceTarget.current = hash;
        setView({ kind: 'workspaces' });
        return;
      }
    }
    loadFromHash();
    window.addEventListener('hashchange', loadFromHash);
    return () => window.removeEventListener('hashchange', loadFromHash);
  }, []);

  // Load a shared report by slug, recording the attempt so Retry can re-run it (4.2).
  async function loadShared(slug: string) {
    lastAttemptRef.current = () => loadShared(slug);
    setView({ kind: 'loading', status: 'loading shared report' });
    try {
      const report = await getReportBySlug(slug);
      setView({ kind: 'report', report, shared: true });
    } catch (e) {
      setView({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  function goHome() {
    if (window.location.hash) window.location.hash = '';
    setView({ kind: 'home' });
  }

  // Hash-route navigation to the account surfaces; the hash handler maps these to
  // the matching view (Req 14.1, hash routing only).
  function goSignIn() {
    window.location.hash = '#/sign-in';
  }
  function goHistory() {
    window.location.hash = '#/history';
  }
  // Workspace_View navigation (Req 13.1, hash routing only).
  function goWorkspaces() {
    window.location.hash = '#/workspaces';
  }
  function openWorkspace(workspaceId: string) {
    window.location.hash = `#/workspaces/${encodeURIComponent(workspaceId)}`;
  }

  // Open a full report by id (used by the History_View select-to-open, Req 9.5, and
  // the post-sign-in return to a gated report). Clears the hash so the report view
  // owns the screen, then loads it; a 401 is piped through the session layer so an
  // expired token falls back to Anonymous (Req 4.4).
  async function openReport(id: string) {
    if (window.location.hash) window.location.hash = '';
    setView({ kind: 'loading', status: 'loading report' });
    try {
      const report = await getReport(id);
      setView({ kind: 'report', report });
    } catch (e) {
      session.handleAuthError(e);
      setView({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  // End the session. useSession discards the local session even when the remote
  // sign-out rejects and rethrows, so on failure we still present Anonymous and warn
  // the remote session may persist (Req 3.5). Always returns to the home view.
  async function handleSignOut() {
    setNotice(null);
    try {
      await session.signOut();
    } catch {
      setNotice('You are signed out on this device, but the remote session may still be active.');
    }
    goHome();
  }

  // After a successful sign-in/sign-up: return to a retained Workspace_View if the
  // reader opened one while anonymous (Req 13.4), else to a gated report if one was
  // pending (Req 6.7; control re-enable is wired in Report.tsx), otherwise go home.
  function afterAuthSuccess() {
    const workspaceTarget = pendingWorkspaceTarget.current;
    if (workspaceTarget) {
      // The hash is already the workspace target and the view state already reflects
      // it; with the session now active the gating renders the Workspace_View. Re-set
      // the hash only if it drifted, which re-triggers routing.
      if (window.location.hash !== workspaceTarget) window.location.hash = workspaceTarget;
      return;
    }
    const pending = session.pendingAction.current;
    if (pending) {
      session.pendingAction.current = null;
      void openReport(pending.reportId);
    } else {
      goHome();
    }
  }

  // Leaving Methodology restores the reader's prior report context if there was one (1.12).
  function leaveMethodology() {
    if (window.location.hash) window.location.hash = '';
    setView(priorReportRef.current ?? { kind: 'home' });
  }

  useEffect(() => {
    if (view.kind !== 'loading') {
      window.clearInterval(stepTimer.current);
      return;
    }
    stepTimer.current = window.setInterval(() => {
      setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
    }, 1600);
    return () => window.clearInterval(stepTimer.current);
  }, [view.kind]);

  // Web_Analytics: emit exactly one 'view' event per distinct view, identified by
  // route + report id only (Req 12.1). A ref-guarded key dedupes re-renders and
  // React StrictMode's dev double-invoke. track() is consent-gated and a no-op
  // without a key, with no render side effects, so the DOM/routing/a11y are
  // identical whether analytics is active or not (Req 12.8).
  useEffect(() => {
    const route =
      view.kind === 'report' ? (view.shared ? '#/r' : '#/report') : `#/${view.kind}`;
    const reportId = view.kind === 'report' ? view.report.id : undefined;
    const key = `${route}:${reportId ?? ''}`;
    if (lastViewKeyRef.current === key) return;
    lastViewKeyRef.current = key;
    track('view', { route, reportId });
  }, [view]);

  async function run(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    lastAttemptRef.current = () => run(trimmed);
    setStepIdx(0);
    setView({ kind: 'loading', status: 'queued' });
    try {
      const { reportId } = await submitAnalysis(detectInput(trimmed));
      const report = await pollReport(reportId, (status) =>
        setView({ kind: 'loading', status }),
      );
      setView({ kind: 'report', report });
    } catch (e) {
      setView({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">f</span>
          <span>
            f-Socials <small>· a lens, not a judge</small>
          </span>
        </div>
        <div className="topbar-actions">
          {/* Header sign-in/sign-out affordance reflecting session state (Req 2.2, 3.3).
              Icons are paired with visible text labels (color/icon-never-alone, Req 14.3);
              every control is a real <button> with an accessible name (Req 14.2, 14.4). */}
          {session.session ? (
            <>
              <button className="btn btn-ghost" onClick={goWorkspaces}>
                <Users size={15} aria-hidden="true" /> Workspaces
              </button>
              <button className="btn btn-ghost" onClick={goHistory}>
                <Bookmark size={15} aria-hidden="true" /> Saved reports
              </button>
              <button className="btn btn-ghost" onClick={() => void handleSignOut()}>
                <LogOut size={15} aria-hidden="true" /> Sign out
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={goSignIn}>
              <LogIn size={15} aria-hidden="true" /> Sign in
            </button>
          )}
          <button
            className="icon-btn"
            aria-label="Toggle theme"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      {/* Header-level status notice (e.g. the sign-out-failed warning, Req 3.5),
          announced through an ARIA live region without requiring a focus change (Req 14.9). */}
      <div aria-live="polite" role="status">
        {notice && (
          <div className="banner error" style={{ margin: '0 24px' }}>
            {notice}
          </div>
        )}
      </div>

      <div className="container">
        {view.kind === 'home' && (
          <Home
            input={input}
            setInput={setInput}
            onSubmit={() => run(input)}
            onExample={(t) => {
              setInput(t);
              run(t);
            }}
          />
        )}

        {view.kind === 'loading' && <Loading status={view.status} stepIdx={stepIdx} />}

        {view.kind === 'error' && (
          <div>
            <div className="banner error" role="alert">{view.message}</div>
            <div className="error-actions">
              {lastAttemptRef.current && (
                <button className="btn" onClick={() => lastAttemptRef.current?.()}>
                  Retry
                </button>
              )}
              <button className="btn btn-ghost" onClick={goHome}>
                Back
              </button>
            </div>
          </div>
        )}

        {view.kind === 'report' && (
          <Report
            report={view.report}
            shared={view.shared}
            onBack={goHome}
            session={session}
            onRequireSignIn={goSignIn}
          />
        )}

        {view.kind === 'methodology' && (
          <MethodologyBoundary onBack={leaveMethodology}>
            <Methodology onBack={leaveMethodology} />
          </MethodologyBoundary>
        )}

        {view.kind === 'review' && <ReviewerConsole onBack={goHome} />}

        {/* Accounts surface (Req 14.1). AuthPanel itself renders the unavailable
            message and no form when not Auth_Configured (Req 5.1). On success we
            return to a pending gated report or go home. */}
        {view.kind === 'sign-in' && (
          <AuthPanel session={session} onSuccess={afterAuthSuccess} />
        )}

        {/* History_View is gated on an active session token. While the session is
            still restoring we show the loading state; an Anonymous reader is
            redirected to the sign-in surface (Req 9 gating); a 401 during load clears
            the session via onAuthError and this falls back to Anonymous (Req 4.4). */}
        {view.kind === 'history' &&
          (session.loading ? (
            <Loading status="restoring your session" stepIdx={0} />
          ) : session.session ? (
            <HistoryView
              token={session.session.accessToken}
              onOpenReport={openReport}
              onBack={goHome}
              onAuthError={session.handleAuthError}
            />
          ) : (
            <AuthPanel session={session} onSuccess={afterAuthSuccess} />
          ))}

        {/* Workspace list (#/workspaces). While the session restores we show loading.
            When not Auth_Configured the WorkspaceListView itself renders the
            features-unavailable message and no create/redeem forms, and never crashes
            (Req 12.1, 12.4). When Auth_Configured but anonymous, opening a Workspace_View
            presents the sign-in flow while the workspace hash is retained, so the reader
            returns here after signing in (Req 13.4). A 401 raised by a workspace call is
            piped through onAuthError so the session is torn down and the app falls back to
            Anonymous (Req 13.5). */}
        {view.kind === 'workspaces' &&
          (session.loading ? (
            <Loading status="restoring your session" stepIdx={0} />
          ) : !session.configured ? (
            <WorkspaceListView
              isAuthConfigured={false}
              onOpenWorkspace={openWorkspace}
              onBack={goHome}
            />
          ) : session.session ? (
            <WorkspaceListView
              isAuthConfigured
              token={session.session.accessToken}
              onOpenWorkspace={openWorkspace}
              onBack={goHome}
              onAuthError={session.handleAuthError}
            />
          ) : (
            <AuthPanel session={session} onSuccess={afterAuthSuccess} />
          ))}

        {/* Workspace detail (#/workspaces/:id). Same session gating as the list; the
            detail view requires an active session (token + reader id), so it only renders
            with one. When not Auth_Configured the list view's unavailable message stands in
            so boot never crashes (Req 12.4). A 403 access-denied message is rendered inside
            WorkspaceDetailView (Req 13.6); a 401 falls back to Anonymous via onAuthError
            (Req 13.5). */}
        {view.kind === 'workspace-detail' &&
          (session.loading ? (
            <Loading status="restoring your session" stepIdx={0} />
          ) : !session.configured ? (
            <WorkspaceListView
              isAuthConfigured={false}
              onOpenWorkspace={openWorkspace}
              onBack={goHome}
            />
          ) : session.session ? (
            <WorkspaceDetailView
              workspaceId={view.workspaceId}
              token={session.session.accessToken}
              currentReaderId={session.session.reader.id}
              onBack={goWorkspaces}
              onAuthError={session.handleAuthError}
            />
          ) : (
            <AuthPanel session={session} onSuccess={afterAuthSuccess} />
          ))}
      </div>
    </div>
  );
}

function Home(props: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: () => void;
  onExample: (t: string) => void;
}) {
  return (
    <>
      <div className="hero">
        <h1>Inspect before you react.</h1>
        <p>
          Paste a YouTube link, article URL, or transcript. We show how the content is built — its
          claims, framing, omissions, and other credible angles — so you can decide what to think.
        </p>
        <div className="input-card">
          <textarea
            value={props.input}
            onChange={(e) => props.setInput(e.target.value)}
            placeholder="Paste a YouTube link, article URL, or transcript…"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') props.onSubmit();
            }}
          />
          <button className="btn" onClick={props.onSubmit} disabled={!props.input.trim()}>
            Analyze
          </button>
        </div>
        <div className="hint">It assesses claims and cites sources — it never declares "true" or "false".</div>
      </div>

      <div className="examples">
        <h4>Or try an example</h4>
        <div className="example-grid">
          {EXAMPLES.map((ex) => (
            <button key={ex.label} className="example-card" onClick={() => props.onExample(ex.text)}>
              <strong>{ex.label}</strong>
              {ex.blurb}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Loading(props: { status: string; stepIdx: number }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <div className="section-label">Analyzing — {props.status}</div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`step ${i === props.stepIdx ? 'active' : ''} ${i < props.stepIdx ? 'done' : ''}`}
          >
            <span className="dot">{i < props.stepIdx ? '✓' : i + 1}</span>
            <span>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
