import { ReportData } from '../../data/reportData';

interface ProvenanceFooterProps {
  data: ReportData;
}

export default function ProvenanceFooter({ data }: ProvenanceFooterProps) {
  return (
    <div className="space-y-5">
      {/* Section intro */}
      <div className="space-y-2 pb-2">
        <p className="text-xs font-mono text-[#6ea8c4]/70 tracking-widest uppercase">05 · Provenance</p>
        <h2 className="text-xl font-semibold text-[#e2e4e9] tracking-tight">How this report was produced</h2>
        <p className="text-sm text-zinc-500 leading-relaxed max-w-2xl">
          Full provenance is part of the trust contract. Every report documents who produced it,
          which system version, what policy governed it, and whether any human review occurred.
        </p>
      </div>

      {/* Provenance table */}
      <div className="rounded-xl border border-white/8 bg-[#161922]/60 overflow-hidden">
        {[
          {
            label: 'Produced by',
            value: 'AI — F-Socials Analysis Engine',
            note: 'No human author. AI-generated analysis.',
            icon: <AIIcon />,
          },
          {
            label: 'Model version',
            value: data.modelVersion,
            note: 'Analysis model used for claim extraction and framing detection',
            icon: <VersionIcon />,
          },
          {
            label: 'Policy version',
            value: data.policyVersion,
            note: 'Content handling and source selection rules in effect at time of analysis',
            icon: <DocIcon />,
          },
          {
            label: 'Report ID',
            value: data.id,
            note: 'Unique identifier for this analysis snapshot',
            icon: <IdIcon />,
          },
          {
            label: 'Last reviewed by',
            value: data.reviewStatus,
            note: 'Expert review and community signal review are not yet available in this version',
            icon: <ReviewIcon />,
            highlight: true,
          },
          {
            label: 'Date analyzed',
            value: data.dateAnalyzed,
            note: 'Conditions may have changed since this analysis was run',
            icon: <ClockIcon />,
          },
        ].map((row, i) => (
          <div
            key={row.label}
            className={`flex items-start gap-4 px-5 py-4 ${i > 0 ? 'border-t border-white/6' : ''} ${row.highlight ? 'bg-amber-950/10' : ''}`}
          >
            <div className={`mt-0.5 w-6 h-6 rounded flex-shrink-0 flex items-center justify-center border ${row.highlight ? 'border-amber-800/30 bg-amber-950/30 text-amber-400' : 'border-white/8 bg-white/[0.02] text-zinc-500'}`}>
              {row.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-mono text-zinc-600 uppercase tracking-wide">{row.label}</span>
                <span className={`text-sm font-medium font-mono ${row.highlight ? 'text-amber-300' : 'text-zinc-300'}`}>{row.value}</span>
              </div>
              <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">{row.note}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-3">
        <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 bg-white/[0.02] text-sm text-zinc-400 hover:text-zinc-200 hover:border-white/20 transition-all font-medium">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Dispute this analysis
        </button>
        <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 bg-white/[0.02] text-sm text-zinc-400 hover:text-zinc-200 hover:border-white/20 transition-all font-medium">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          View methodology
        </button>
        <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 bg-white/[0.02] text-sm text-zinc-400 hover:text-zinc-200 hover:border-white/20 transition-all font-medium">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          Share report
        </button>
      </div>

      {/* AI disclaimer */}
      <div className="p-4 rounded-xl border border-amber-800/15 bg-amber-950/10 space-y-2">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className="text-xs font-semibold text-amber-400/80 font-mono">AI-generated · Unreviewed</p>
        </div>
        <p className="text-xs text-amber-200/40 leading-relaxed">
          This report was produced entirely by AI. It may contain errors, omissions, or misidentified framing.
          Evidence assessments are provisional. No claim in this report constitutes a verdict of truth, falsity, or intent.
          F-Socials is a lens, not a judge. Verify citations independently before sharing.
        </p>
      </div>
    </div>
  );
}

function AIIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  );
}

function VersionIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function IdIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function ReviewIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
