import { useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { detectInput, getReportBySlug, pollReport, submitAnalysis } from './api/client';
import type { AnalysisReport } from './api/types';
import { Report } from './components/Report';

type View =
  | { kind: 'home' }
  | { kind: 'loading'; status: string }
  | { kind: 'report'; report: AnalysisReport; shared?: boolean }
  | { kind: 'error'; message: string };

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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Shared report deep-link: #/r/<slug>
  useEffect(() => {
    async function loadFromHash() {
      const m = window.location.hash.match(/^#\/r\/([A-Za-z0-9]+)/);
      if (!m) return;
      setView({ kind: 'loading', status: 'loading shared report' });
      try {
        const report = await getReportBySlug(m[1]);
        setView({ kind: 'report', report, shared: true });
      } catch (e) {
        setView({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }
    loadFromHash();
    window.addEventListener('hashchange', loadFromHash);
    return () => window.removeEventListener('hashchange', loadFromHash);
  }, []);

  function goHome() {
    if (window.location.hash) window.location.hash = '';
    setView({ kind: 'home' });
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
            <div className="banner error">{view.message}</div>
            <button className="btn btn-ghost" onClick={goHome}>
              Back
            </button>
          </div>
        )}

        {view.kind === 'report' && (
          <Report report={view.report} shared={view.shared} onBack={goHome} />
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
