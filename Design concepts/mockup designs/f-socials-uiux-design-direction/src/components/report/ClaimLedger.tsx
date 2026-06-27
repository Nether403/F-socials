import { useState } from 'react';
import { Claim, claimTypeColors, verifiabilityColors, evidenceLabelColors, evidenceStrengthBar } from '../../data/reportData';

interface ClaimLedgerProps {
  claims: Claim[];
}

const claimTypeLabels: Record<string, string> = {
  factual: 'Factual',
  causal: 'Causal',
  predictive: 'Predictive',
  opinion: 'Opinion',
  quote: 'Quote',
};

const verifiabilityLabels: Record<string, string> = {
  'verifiable': 'Verifiable',
  'partly-verifiable': 'Partly verifiable',
  'opinion': 'Opinion',
  'unclear': 'Unclear',
};

const evidenceStrengthLabels: Record<string, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  weak: 'Weak',
  insufficient: 'Insufficient',
};

const evidenceStrengthDots: Record<string, number> = {
  strong: 4, moderate: 3, weak: 2, insufficient: 1,
};

export default function ClaimLedger({ claims }: ClaimLedgerProps) {
  const [openDrawers, setOpenDrawers] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<string>('all');

  const toggleDrawer = (id: string) => {
    setOpenDrawers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allTypes = Array.from(new Set(claims.map(c => c.type)));
  const filtered = filterType === 'all' ? claims : claims.filter(c => c.type === filterType);

  return (
    <div className="space-y-6">
      <SectionIntro
        label="01 · Claim Ledger"
        title="What this content says"
        desc="Each identifiable claim is logged with its type, how verifiable it is, the strength of available evidence, and any citations we could trace. Expand a claim to inspect the evidence drawer."
      />

      {/* Legend row */}
      <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-zinc-600 px-1">
        <span>Claim type:</span>
        {allTypes.map(type => (
          <span key={type} className="flex items-center gap-1.5">
            <span className={`px-1.5 py-0.5 rounded border text-[10px] ${claimTypeColors[type]}`}>{claimTypeLabels[type]}</span>
          </span>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        <FilterTab active={filterType === 'all'} onClick={() => setFilterType('all')}>
          All claims ({claims.length})
        </FilterTab>
        {allTypes.map(type => (
          <FilterTab key={type} active={filterType === type} onClick={() => setFilterType(type)}>
            {claimTypeLabels[type]} ({claims.filter(c => c.type === type).length})
          </FilterTab>
        ))}
      </div>

      {/* Claims list */}
      <div className="space-y-3">
        {filtered.map((claim, idx) => {
          const isOpen = openDrawers.has(claim.id);
          const evidenceColor = evidenceLabelColors[claim.evidenceLabel] || 'text-zinc-400';
          const dots = evidenceStrengthDots[claim.evidenceStrength];

          return (
            <div
              key={claim.id}
              className={`rounded-xl border transition-all duration-200 overflow-hidden card-hover ${
                isOpen
                  ? 'border-white/14 bg-[#161922] shadow-[0_2px_20px_rgba(0,0,0,0.2)]'
                  : 'border-white/8 bg-[#161922]/70'
              }`}
            >
              {/* Top accent line based on evidence strength */}
              <div className={`h-px ${evidenceStrengthBar[claim.evidenceStrength].color}`} style={{ opacity: 0.6 }} />

              <div className="p-5 space-y-4">
                {/* Claim index + badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-xs font-mono text-zinc-700 border border-white/8 bg-white/[0.02]">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className={`tag px-2 py-0.5 rounded border ${claimTypeColors[claim.type]}`}>
                    {claimTypeLabels[claim.type]}
                  </span>
                  <span className={`tag px-2 py-0.5 rounded border ${verifiabilityColors[claim.verifiability]}`}>
                    {verifiabilityLabels[claim.verifiability]}
                  </span>
                  <span className="flex-1" />
                  {claim.citationCount > 0 && (
                    <span className="text-xs font-mono text-zinc-600 flex items-center gap-1">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                      </svg>
                      {claim.citationCount} source{claim.citationCount > 1 ? 's' : ''} traced
                    </span>
                  )}
                </div>

                {/* Claim text */}
                <p className="text-sm text-zinc-200 leading-relaxed">{claim.text}</p>

                {/* Detected span */}
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-white/[0.02] border border-white/6">
                  <span className="text-zinc-700 text-base leading-none mt-0.5 font-serif select-none">"</span>
                  <p className="text-xs text-zinc-500 italic leading-relaxed">{claim.span}</p>
                </div>

                {/* Evidence row */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  {/* Strength dots */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-zinc-600">Evidence</span>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4].map(i => (
                        <div
                          key={i}
                          className={`w-2 h-2 rounded-full border transition-all ${
                            i <= dots
                              ? `${evidenceStrengthBar[claim.evidenceStrength].color.replace('bg-', 'bg-')} border-transparent`
                              : 'border-white/10 bg-transparent'
                          }`}
                          style={i <= dots ? {} : { background: 'transparent' }}
                        >
                          <div className={`w-full h-full rounded-full ${i <= dots ? evidenceStrengthBar[claim.evidenceStrength].color : 'bg-white/8'}`} />
                        </div>
                      ))}
                    </div>
                    <span className="text-xs font-mono text-zinc-500">{evidenceStrengthLabels[claim.evidenceStrength]}</span>
                  </div>

                  {/* Evidence label */}
                  <div className={`text-xs font-medium ${evidenceColor} flex items-center gap-1.5`}>
                    <EvidenceIcon label={claim.evidenceLabel} />
                    {claim.evidenceLabel}
                  </div>
                </div>

                {/* Expand button */}
                <button
                  onClick={() => toggleDrawer(claim.id)}
                  className="flex items-center gap-2 text-xs text-zinc-600 hover:text-[#6ea8c4] transition-colors font-mono group"
                >
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  <span>{isOpen ? 'Close evidence drawer' : 'Open evidence drawer'}</span>
                  {!isOpen && claim.citations.length > 0 && (
                    <span className="text-zinc-700">— {claim.citations.length} source{claim.citations.length > 1 ? 's' : ''}</span>
                  )}
                </button>
              </div>

              {/* Evidence drawer */}
              {isOpen && (
                <div className="border-t border-white/6 bg-[#13161f]/80 px-5 py-5 space-y-5 drawer-enter">
                  {/* Evidence notes */}
                  <div className="space-y-2">
                    <p className="text-xs font-mono text-zinc-600 uppercase tracking-widest">Evidence notes</p>
                    <p className="text-sm text-zinc-400 leading-relaxed">{claim.evidenceNotes}</p>
                  </div>

                  {/* Citations */}
                  {claim.citations.length > 0 ? (
                    <div className="space-y-2.5">
                      <p className="text-xs font-mono text-zinc-600 uppercase tracking-widest">
                        Sources traced ({claim.citations.length})
                      </p>
                      {claim.citations.map((cit, citIdx) => (
                        <div key={cit.id} className="p-4 rounded-xl border border-white/8 bg-[#161922] space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2.5 flex-1">
                              <span className="font-mono text-xs text-zinc-700 mt-0.5">#{citIdx + 1}</span>
                              <p className="text-sm text-zinc-200 font-medium leading-snug">{cit.title}</p>
                            </div>
                            <a
                              href={cit.url}
                              className="flex-shrink-0 w-6 h-6 rounded border border-white/8 flex items-center justify-center text-zinc-600 hover:text-[#6ea8c4] hover:border-[#6ea8c4]/25 transition-all"
                              title="View source"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </a>
                          </div>
                          <div className="flex items-center gap-2 text-xs font-mono text-zinc-600 pl-5">
                            <span className="text-zinc-500">{cit.outlet}</span>
                            <span className="text-zinc-700">·</span>
                            <span>{cit.publishedDate}</span>
                          </div>
                          <p className="text-xs text-zinc-500 leading-relaxed pl-5 border-l border-white/6">{cit.relevance}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl border border-white/6 bg-[#161922] flex items-center gap-3">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-700 flex-shrink-0">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <p className="text-xs text-zinc-600 font-mono">No citations traced in the source article for this claim.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-white/5 bg-white/[0.01]">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-700 mt-0.5 flex-shrink-0">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p className="text-xs text-zinc-600 leading-relaxed">
          Evidence labels ("Supported by cited source," "Mixed evidence," "Context needed," "No sufficient source found") reflect the
          state of available citations — not a verdict on truth. "No sufficient source found" means no citation was available to assess,
          not that the claim is false.
        </p>
      </div>
    </div>
  );
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all border ${
        active
          ? 'bg-[#6ea8c4]/10 border-[#6ea8c4]/25 text-[#6ea8c4]'
          : 'border-white/8 bg-transparent text-zinc-500 hover:text-zinc-300 hover:border-white/14'
      }`}
    >
      {children}
    </button>
  );
}

function EvidenceIcon({ label }: { label: string }) {
  if (label === 'Supported by cited source') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (label === 'No sufficient source found') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
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
