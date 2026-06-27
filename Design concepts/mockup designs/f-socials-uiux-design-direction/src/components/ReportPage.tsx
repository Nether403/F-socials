import { useState, useEffect, useRef, useCallback } from 'react';
import { reportData } from '../data/reportData';
import ReportHeader from './report/ReportHeader';
import ClaimLedger from './report/ClaimLedger';
import FramingSignals from './report/FramingSignals';
import RelatedContext from './report/RelatedContext';
import BridgingSources from './report/BridgingSources';
import ProvenanceFooter from './report/ProvenanceFooter';
import SideNav from './report/SideNav';

interface ReportPageProps {
  onNewAnalysis: () => void;
}

const sections = [
  'analyzed-content',
  'claim-ledger',
  'framing-signals',
  'related-context',
  'bridging-sources',
  'provenance',
];

export default function ReportPage({ onNewAnalysis }: ReportPageProps) {
  const [activeSection, setActiveSection] = useState('analyzed-content');
  const [shareToast, setShareToast] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const handleSectionVisible = useCallback((id: string) => {
    setActiveSection(id);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? Math.round((scrollTop / docHeight) * 100) : 0;
      setScrollProgress(progress);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: '-20% 0px -60% 0px',
      threshold: 0,
    };

    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          handleSectionVisible(entry.target.id);
        }
      });
    }, options);

    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [handleSectionVisible]);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href).catch(() => {});
    setShareToast(true);
    setTimeout(() => setShareToast(false), 2500);
  };

  const data = reportData;

  return (
    <div className="min-h-screen bg-[#0f1117]">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-[#0f1117]/95 backdrop-blur-md border-b border-white/5">
        {/* Reading progress */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-white/4">
          <div
            className="h-full bg-[#6ea8c4]/50 transition-all duration-100"
            style={{ width: `${scrollProgress}%` }}
          />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <LensIcon />
            <span className="text-[#e2e4e9] font-semibold tracking-tight">F-Socials</span>
            <span className="hidden sm:inline tag px-2 py-0.5 rounded border border-white/10 text-zinc-600">BETA</span>
          </div>

          {/* URL strip */}
          <div className="hidden md:flex items-center gap-2 min-w-0 flex-1 mx-4">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500/60 flex-shrink-0" />
            <span className="text-xs font-mono text-zinc-600 truncate">{data.analyzedUrl}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20 text-xs font-medium transition-all"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              <span className="hidden sm:inline">Share</span>
            </button>
            <button
              onClick={onNewAnalysis}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#6ea8c4]/10 border border-[#6ea8c4]/20 text-[#6ea8c4] hover:bg-[#6ea8c4]/15 text-xs font-medium transition-all"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New inspection
            </button>
            {/* Mobile nav toggle */}
            <button
              onClick={() => setMobileNavOpen(v => !v)}
              className="lg:hidden p-1.5 rounded-lg border border-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile nav dropdown */}
        {mobileNavOpen && (
          <div className="lg:hidden border-t border-white/6 bg-[#0f1117] px-4 py-3">
            <MobileNav activeSection={activeSection} onClose={() => setMobileNavOpen(false)} />
          </div>
        )}
      </header>

      {/* Share toast */}
      {shareToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl border border-teal-700/40 bg-[#161922] text-sm text-teal-300 font-medium shadow-xl drawer-enter">
          Link copied to clipboard
        </div>
      )}

      {/* Main layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex gap-8">
          {/* Sticky sidebar — desktop */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <div className="sticky top-24">
              <SideNav activeSection={activeSection} />

              {/* Provenance pill in sidebar */}
              <div className="mt-8 p-3 rounded-xl border border-white/6 bg-white/[0.02] space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500/70" />
                  <p className="text-xs font-mono text-amber-400/70">AI · Unreviewed</p>
                </div>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  No human has reviewed this analysis. Verify citations before sharing.
                </p>
                <p className="text-xs font-mono text-zinc-700">{data.provenanceVersion}</p>
              </div>
            </div>
          </aside>

          {/* Content */}
          <main className="flex-1 min-w-0 space-y-16">
            {/* Section: Overview */}
            <section id="analyzed-content">
              <ReportHeader data={data} />
            </section>

            {/* Divider */}
            <SectionDivider />

            {/* Section: Claim Ledger */}
            <section id="claim-ledger">
              <ClaimLedger claims={data.claims} />
            </section>

            <SectionDivider />

            {/* Section: Framing Signals */}
            <section id="framing-signals">
              <FramingSignals signals={data.framingSignals} />
            </section>

            <SectionDivider />

            {/* Section: Related Context */}
            <section id="related-context">
              <RelatedContext items={data.contextItems} />
            </section>

            <SectionDivider />

            {/* Section: Bridging Sources */}
            <section id="bridging-sources">
              <BridgingSources sources={data.bridgingSources} />
            </section>

            <SectionDivider />

            {/* Section: Provenance */}
            <section id="provenance">
              <ProvenanceFooter data={data} />
            </section>

            {/* Footer */}
            <footer className="pt-8 pb-4 border-t border-white/6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <LensIcon size={16} />
                  <span className="text-xs text-zinc-600">F-Socials · Lens, not judge</span>
                </div>
                <div className="flex items-center gap-4">
                  <a href="#" className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors">Methodology</a>
                  <a href="#" className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors">Content Policy</a>
                  <a href="#" className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors">Dispute</a>
                </div>
              </div>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}

function SectionDivider() {
  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 h-px bg-white/5" />
      <div className="w-1 h-1 rounded-full bg-white/10" />
      <div className="flex-1 h-px bg-white/5" />
    </div>
  );
}

function LensIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="text-[#6ea8c4]">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

const mobileNavItems = [
  { id: 'analyzed-content', label: 'Overview' },
  { id: 'claim-ledger', label: 'Claim Ledger' },
  { id: 'framing-signals', label: 'Framing Signals' },
  { id: 'related-context', label: 'Related Context' },
  { id: 'bridging-sources', label: 'Bridging Sources' },
  { id: 'provenance', label: 'Provenance' },
];

function MobileNav({ activeSection, onClose }: { activeSection: string; onClose: () => void }) {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const y = el.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
    onClose();
  };

  return (
    <div className="flex flex-wrap gap-2">
      {mobileNavItems.map(item => (
        <button
          key={item.id}
          onClick={() => scrollTo(item.id)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
            activeSection === item.id
              ? 'border-[#6ea8c4]/30 bg-[#6ea8c4]/10 text-[#6ea8c4]'
              : 'border-white/8 bg-white/[0.02] text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
