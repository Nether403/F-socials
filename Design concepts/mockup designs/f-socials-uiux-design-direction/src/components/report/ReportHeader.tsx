import { ReportData } from '../../data/reportData';

interface ReportHeaderProps {
  data: ReportData;
}

export default function ReportHeader({ data }: ReportHeaderProps) {
  return (
    <div className="space-y-6">
      {/* Section label */}
      <p className="text-xs font-mono text-[#6ea8c4]/70 tracking-widest uppercase">Analyzed content</p>

      {/* Platform + dates row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-mono text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#6ea8c4]/50" />
          {data.platform}
        </span>
        <span className="text-zinc-700">·</span>
        <span>Published {data.contentDate}</span>
        <span className="text-zinc-700">·</span>
        <span>Analyzed {data.dateAnalyzed}</span>
      </div>

      {/* Title */}
      <div className="space-y-3">
        <h1 className="text-2xl sm:text-[1.75rem] font-semibold text-[#e2e4e9] leading-snug tracking-tight">
          {data.contentTitle}
        </h1>

        {/* Source URL */}
        <div className="flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-700 flex-shrink-0">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <a
            href={data.analyzedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-zinc-600 hover:text-[#6ea8c4] transition-colors truncate font-mono"
          >
            {data.analyzedUrl}
          </a>
        </div>
      </div>

      {/* TL;DR card */}
      <div className="relative p-5 rounded-xl border border-white/10 bg-[#161922]/80 overflow-hidden">
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5"
          style={{ background: 'linear-gradient(to bottom, #6ea8c4, #9b8fc4)' }}
        />
        <div className="pl-4 space-y-2">
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Summary</p>
          <p className="text-sm text-zinc-300 leading-relaxed">{data.tldr}</p>
        </div>
      </div>

      {/* Provenance chips */}
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceChip
          icon={<AIIcon />}
          label="AI-generated"
          sub="No human author"
        />
        <ProvenanceChip
          icon={<WarningIcon />}
          label="Citations unverified"
          sub="Check independently"
          amber
        />
        <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full border border-[#6ea8c4]/15 bg-[#6ea8c4]/[0.04] text-xs font-mono text-[#6ea8c4]/60">
          {data.provenanceVersion}
        </div>
      </div>

      {/* Quick stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            value: '5',
            label: 'Claims identified',
            sub: 'factual · causal · predictive · opinion · quote',
            color: 'text-sky-400',
          },
          {
            value: '4',
            label: 'Framing signals',
            sub: 'language & structure patterns',
            color: 'text-amber-400',
          },
          {
            value: '4',
            label: 'Context items',
            sub: 'related independent reporting',
            color: 'text-teal-400',
          },
          {
            value: '5',
            label: 'Bridging sources',
            sub: 'divergent credible angles',
            color: 'text-violet-400',
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="px-4 py-3.5 rounded-xl border border-white/8 bg-[#161922]/60 space-y-1.5 card-hover"
          >
            <div className={`text-2xl font-semibold tracking-tight ${stat.color}`}>{stat.value}</div>
            <div className="text-xs font-medium text-zinc-400">{stat.label}</div>
            <div className="text-[11px] text-zinc-700 leading-tight">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Design rule reminder */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-white/5 bg-white/[0.015]">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="text-[#6ea8c4]/50 flex-shrink-0">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1" opacity="0.4" />
        </svg>
        <p className="text-xs text-zinc-600 leading-relaxed">
          This report is a lens, not a verdict. Every section is designed to help you inspect — not to pressure you to accept a conclusion.
        </p>
      </div>
    </div>
  );
}

function ProvenanceChip({ icon, label, sub, amber }: { icon: React.ReactNode; label: string; sub: string; amber?: boolean }) {
  return (
    <div className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full border text-xs font-mono ${
      amber
        ? 'border-amber-800/25 bg-amber-950/15 text-amber-400/70'
        : 'border-white/10 bg-white/[0.025] text-zinc-500'
    }`}>
      <span className={amber ? 'text-amber-500/60' : 'text-zinc-600'}>{icon}</span>
      <span>{label}</span>
      <span className={amber ? 'text-amber-600/50' : 'text-zinc-700'}>· {sub}</span>
    </div>
  );
}

function AIIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
