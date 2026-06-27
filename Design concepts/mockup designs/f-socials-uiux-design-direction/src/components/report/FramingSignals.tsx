import { useState } from 'react';
import { FramingSignal, framingIntensityConfig } from '../../data/reportData';

interface FramingSignalsProps {
  signals: FramingSignal[];
}

export default function FramingSignals({ signals }: FramingSignalsProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([signals[0]?.id]));

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const notable = signals.filter(s => s.intensity === 'high').length;
  const moderate = signals.filter(s => s.intensity === 'medium').length;

  return (
    <div className="space-y-6">
      <SectionIntro
        label="02 · Framing Signals"
        title="How it is framed"
        desc="Observed patterns in language, source selection, and rhetorical structure. Each card is an annotation, not an accusation. The goal is to make framing visible — not to characterize intent."
      />

      {/* Summary chips */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-mono text-zinc-600">Detected:</span>
        {notable > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-orange-800/25 bg-orange-950/15 text-xs font-mono text-orange-300/80">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            {notable} notable
          </div>
        )}
        {moderate > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-800/25 bg-amber-950/15 text-xs font-mono text-amber-300/80">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            {moderate} moderate
          </div>
        )}
        <span className="text-xs font-mono text-zinc-700">across {signals.length} patterns</span>
      </div>

      {/* Signal cards */}
      <div className="space-y-3">
        {signals.map((signal, idx) => {
          const isExpanded = expanded.has(signal.id);
          const intensityCfg = framingIntensityConfig[signal.intensity];

          return (
            <div
              key={signal.id}
              className={`rounded-xl border overflow-hidden card-hover transition-all duration-200 ${
                isExpanded
                  ? 'border-white/12 bg-[#161922] shadow-[0_2px_20px_rgba(0,0,0,0.2)]'
                  : 'border-white/8 bg-[#161922]/70'
              }`}
            >
              {/* Intensity accent */}
              <div className={`h-px ${intensityCfg.dot.replace('bg-', 'bg-')}`} style={{ opacity: 0.5 }} />

              <div className="p-5 space-y-4">
                {/* Header row */}
                <div className="flex items-start gap-3 justify-between">
                  <div className="flex items-start gap-3">
                    {/* Index */}
                    <span className="mt-0.5 w-5 h-5 flex-shrink-0 flex items-center justify-center text-xs font-mono text-zinc-700 border border-white/8 bg-white/[0.02] rounded">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Framing signal</p>
                      <p className={`text-sm font-semibold ${intensityCfg.color}`}>{signal.type}</p>
                    </div>
                  </div>
                  {/* Intensity badge */}
                  <div className={`flex items-center gap-1.5 tag px-2 py-1 rounded border border-white/8 ${intensityCfg.color} bg-white/[0.02]`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${intensityCfg.dot}`} />
                    {intensityCfg.label}
                  </div>
                </div>

                {/* Description */}
                <p className="text-sm text-zinc-300 leading-relaxed">{signal.description}</p>

                {/* Detected span */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Detected span</p>
                  <div className="relative pl-3 border-l-2 border-white/8">
                    <p className="text-xs text-zinc-500 italic leading-relaxed">{signal.span}</p>
                  </div>
                </div>

                {/* Toggle */}
                <button
                  onClick={() => toggle(signal.id)}
                  className="flex items-center gap-2 text-xs text-zinc-600 hover:text-[#6ea8c4] transition-colors font-mono"
                >
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  {isExpanded ? 'Hide explanation' : 'Why is this shown?'}
                </button>
              </div>

              {/* Explanation drawer */}
              {isExpanded && (
                <div className="border-t border-white/6 bg-[#13161f]/80 px-5 py-4 drawer-enter">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 w-5 h-5 flex-shrink-0 rounded border border-white/8 bg-white/[0.02] flex items-center justify-center">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Why shown</p>
                      <p className="text-sm text-zinc-400 leading-relaxed">{signal.whyShown}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Framing note */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-white/5 bg-white/[0.01]">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-700 mt-0.5 flex-shrink-0">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p className="text-xs text-zinc-600 leading-relaxed">
          Framing analysis identifies observable patterns in language, structure, and sourcing.
          It does not assess the intent of the author or the truthfulness of individual claims.
          Framing signals appear in all media — their presence alone is not an indication of deception or bias.
        </p>
      </div>
    </div>
  );
}

function SectionIntro({ label, title, desc }: { label: string; title: string; desc: string }) {
  return (
    <div className="space-y-2 pb-2">
      <p className="text-xs font-mono text-[#6ea8c4]/70 tracking-widest uppercase">{label}</p>
      <h2 className="text-xl font-semibold text-[#e2e4e9] tracking-tight">{title}</h2>
      <p className="text-sm text-zinc-500 leading-relaxed max-w-2xl">{desc}</p>
    </div>
  );
}
