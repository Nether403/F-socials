import { useState } from 'react';

interface LandingPageProps {
  onAnalyze: (url: string) => void;
}

export default function LandingPage({ onAnalyze }: LandingPageProps) {
  const [url, setUrl] = useState('');
  const [focused, setFocused] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed) onAnalyze(trimmed);
  };

  const handleExample = () => {
    const ex = 'https://example-news.com/article/tech-regulation-threatens-economy';
    setUrl(ex);
    onAnalyze(ex);
  };

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col relative overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: 'linear-gradient(rgba(110,168,196,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(110,168,196,0.3) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
        {/* Radial glow */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] opacity-[0.06]"
          style={{ background: 'radial-gradient(ellipse at center, #6ea8c4, transparent 70%)' }}
        />
        <div
          className="absolute bottom-0 left-1/4 w-[500px] h-[300px] opacity-[0.04]"
          style={{ background: 'radial-gradient(ellipse at center, #9b8fc4, transparent 70%)' }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 px-6 py-5 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-3">
          <LensLogo />
          <span className="text-[#e2e4e9] font-semibold tracking-tight text-lg">F-Socials</span>
          <span className="tag px-2 py-0.5 rounded border border-white/10 text-zinc-600 hidden sm:inline">BETA</span>
        </div>
        <nav className="flex items-center gap-6">
          <a href="#how" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors hidden sm:block">How it works</a>
          <a href="#mission" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors hidden sm:block">Mission</a>
          <button className="text-sm px-3 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200 transition-all">
            Sign in
          </button>
        </nav>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex flex-col items-center px-6 py-16 sm:py-24">
        <div className="w-full max-w-2xl mx-auto space-y-8">

          {/* Badge */}
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#6ea8c4]/20 bg-[#6ea8c4]/5 text-[#6ea8c4] text-xs font-mono tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-[#6ea8c4] scan-pulse" />
              Media Intelligence Lens · Not a verdict engine
            </div>
          </div>

          {/* Headline */}
          <div className="text-center space-y-5">
            <h1 className="text-4xl sm:text-[3.25rem] font-semibold text-[#e2e4e9] leading-[1.12] tracking-tight">
              Inspect what you read.{' '}
              <span
                className="text-transparent bg-clip-text"
                style={{ backgroundImage: 'linear-gradient(135deg, #6ea8c4 0%, #9b8fc4 100%)' }}
              >
                You decide what to think.
              </span>
            </h1>
            <p className="text-lg text-zinc-400 max-w-lg mx-auto leading-relaxed font-light">
              Paste any article, video, or post. F-Socials surfaces what's claimed,
              how it's framed, and where other credible voices stand.
              <span className="text-zinc-500"> No scores. No verdicts.</span>
            </p>
          </div>

          {/* URL Input */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div
              className={`relative rounded-xl border transition-all duration-200 ${
                focused
                  ? 'border-[#6ea8c4]/40 shadow-[0_0_0_4px_rgba(110,168,196,0.07)]'
                  : 'border-white/10 hover:border-white/16'
              } bg-[#161922]`}
            >
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600">
                <LinkIcon />
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder="Paste a URL — article, video, post, thread…"
                className="w-full bg-transparent pl-11 pr-32 py-4 text-[#e2e4e9] placeholder-zinc-600 text-base outline-none font-sans"
              />
              <button
                type="submit"
                disabled={!url.trim()}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 px-4 py-2 rounded-lg bg-[#6ea8c4] hover:bg-[#7ab9d5] active:scale-95 disabled:bg-[#1e2535] disabled:text-zinc-600 disabled:cursor-not-allowed text-[#0b0f17] text-sm font-semibold transition-all"
              >
                Inspect →
              </button>
            </div>

            <div className="flex items-center justify-center gap-3 text-xs">
              <span className="text-zinc-700">Try a demo:</span>
              <button
                type="button"
                onClick={handleExample}
                className="text-zinc-500 hover:text-[#6ea8c4] underline underline-offset-2 transition-colors"
              >
                Tech regulation article
              </button>
            </div>
          </form>

          {/* Report section pills */}
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {[
              { symbol: '⬡', label: 'Claim Ledger', desc: 'Every statement logged' },
              { symbol: '◈', label: 'Framing Signals', desc: 'Language patterns visible' },
              { symbol: '◎', label: 'Related Context', desc: 'What else is out there' },
              { symbol: '◇', label: 'Bridging Sources', desc: 'Credible divergent angles' },
              { symbol: '□', label: 'Provenance', desc: 'Who made this, how' },
            ].map((item) => (
              <div
                key={item.label}
                className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/8 bg-white/[0.015] text-zinc-500 text-xs font-mono hover:border-white/14 hover:text-zinc-400 transition-all cursor-default"
                title={item.desc}
              >
                <span className="text-zinc-700 group-hover:text-zinc-500 transition-colors">{item.symbol}</span>
                {item.label}
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div id="how" className="mt-24 w-full max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-xs font-mono text-[#6ea8c4]/60 tracking-widest uppercase mb-3">How the lens works</p>
            <h2 className="text-2xl font-semibold text-[#e2e4e9] tracking-tight">Four steps from paste to perspective</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                step: '01',
                title: 'Paste a link',
                desc: 'Any public URL — article, video, social post, or thread.',
                icon: <LinkIcon />,
              },
              {
                step: '02',
                title: 'Inspect claims',
                desc: 'Every identifiable claim is logged with its type, verifiability, and evidence status.',
                icon: <EyeIcon />,
              },
              {
                step: '03',
                title: 'See other angles',
                desc: 'Bridging sources offer divergent credible perspectives — not opposites, not maximally polarized.',
                icon: <BridgeIcon />,
              },
              {
                step: '04',
                title: 'Share the report',
                desc: 'Every report carries full provenance: model version, policy version, review status.',
                icon: <ShareIcon />,
              },
            ].map((item) => (
              <div
                key={item.step}
                className="relative p-5 rounded-xl border border-white/8 bg-[#161922]/80 space-y-3 card-hover overflow-hidden group"
              >
                {/* Step number watermark */}
                <span className="absolute top-3 right-4 font-mono text-2xl font-bold text-white/[0.03] select-none">
                  {item.step}
                </span>
                <div className="w-8 h-8 rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center text-zinc-500 group-hover:text-[#6ea8c4] group-hover:border-[#6ea8c4]/20 transition-all">
                  {item.icon}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#e2e4e9] mb-1.5">{item.title}</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Mission / Design rule */}
        <div id="mission" className="mt-20 w-full max-w-2xl mx-auto">
          <div className="relative p-6 rounded-2xl border border-[#6ea8c4]/12 bg-[#6ea8c4]/[0.025] overflow-hidden">
            <div
              className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-[0.06]"
              style={{ background: 'radial-gradient(circle, #6ea8c4, transparent)' }}
            />
            <p className="text-[#6ea8c4] text-xs font-mono tracking-widest uppercase mb-4">Design rule</p>
            <blockquote className="text-[#e2e4e9] text-base leading-relaxed">
              "Every important UI element should answer this question:{' '}
              <em className="not-italic font-semibold text-[#6ea8c4]">Does this help the user inspect, or does it pressure the user to accept?</em>
              {' '}If it pressures, remove it."
            </blockquote>
            <p className="text-zinc-600 text-xs mt-4 font-mono">F-Socials product specification · v1</p>
          </div>
        </div>

        {/* What we don't do */}
        <div className="mt-16 w-full max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="p-5 rounded-xl border border-white/6 bg-white/[0.015] space-y-3">
              <p className="text-xs font-mono text-zinc-600 uppercase tracking-wide">What F-Socials is not</p>
              <ul className="space-y-2">
                {[
                  'A fact-checking tribunal',
                  'A political bias meter',
                  'A truth score generator',
                  'An "AI magic answer" engine',
                  'A verdict on intent',
                ].map(item => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-zinc-500">
                    <span className="w-3.5 h-3.5 rounded flex-shrink-0 border border-zinc-700/50 flex items-center justify-center">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-700">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-5 rounded-xl border border-[#6ea8c4]/10 bg-[#6ea8c4]/[0.025] space-y-3">
              <p className="text-xs font-mono text-[#6ea8c4]/60 uppercase tracking-wide">What F-Socials is</p>
              <ul className="space-y-2">
                {[
                  'An annotated reading room',
                  'A media evidence lens',
                  'An investigator\'s clean notebook',
                  'A calm evidence table',
                  'An annotation layer over content',
                ].map(item => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-zinc-400">
                    <span className="w-3.5 h-3.5 rounded flex-shrink-0 border border-[#6ea8c4]/20 flex items-center justify-center">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#6ea8c4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-6 py-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <LensLogo size={16} />
          <span className="text-zinc-600 text-xs">F-Socials · Anti-polarization infrastructure</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#" className="text-xs text-zinc-700 hover:text-zinc-400 transition-colors">Methodology</a>
          <a href="#" className="text-xs text-zinc-700 hover:text-zinc-400 transition-colors">Content Policy</a>
          <a href="#" className="text-xs text-zinc-700 hover:text-zinc-400 transition-colors">Dispute a Report</a>
        </div>
      </footer>
    </div>
  );
}

function LensLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="text-[#6ea8c4]">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <circle cx="11" cy="11" r="1" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function BridgeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h16" />
      <path d="M4 12c0-4 3-7 8-7s8 3 8 7" />
      <path d="M9 12v3" />
      <path d="M15 12v3" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
