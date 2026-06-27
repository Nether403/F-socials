import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { detectInput, getReportBySlug, pollReport, submitAnalysis } from './api/client';
import type { AnalysisReport } from './api/types';
import { Report } from './components/Report';
import { Methodology } from './components/Methodology';

type View =
  | { kind: 'home' }
  | { kind: 'loading'; status: string }
  | { kind: 'report'; report: AnalysisReport; shared?: boolean }
  | { kind: 'methodology' }
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
  const stepTimer = useRef<number | undefined>(undefined);
  // Track the live view so the hash handler (a stable closure) can read it, and
  // remember the last report view to restore when the reader leaves Methodology (1.12).
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const priorReportRef = useRef<View | null>(null);
  // Remember the last attempted request so the error view's Retry can re-run it,
  // whether the failure came from a fresh analysis (run) or a shared-report load (4.2).
  const lastAttemptRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Hash routing: shared report (#/r/<slug>) and the no-auth Methodology page (#/methodology).
  useEffect(() => {
    async function loadFromHash() {
      const hash = window.location.hash;
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
        <button
          className="icon-btn"
          aria-label="Toggle theme"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

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
          <Report report={view.report} shared={view.shared} onBack={goHome} />
        )}

        {view.kind === 'methodology' && (
          <MethodologyBoundary onBack={leaveMethodology}>
            <Methodology onBack={leaveMethodology} />
          </MethodologyBoundary>
        )}
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
