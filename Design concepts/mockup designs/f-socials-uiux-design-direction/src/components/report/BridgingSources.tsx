import React from 'react';
import { BridgingSource, sourceTierColors, evidenceQualityConfig } from '../../data/reportData';

interface BridgingSourcesProps {
  sources: BridgingSource[];
}

const angleIcons: Record<string, React.ReactElement> = {
  'Economic & comparative policy': (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  'Technical & consumer-impact': (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  'Local impact & small business': (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  'Civil liberties & rights': (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  'Scientific & strategic': (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
};

export default function BridgingSources({ sources }: BridgingSourcesProps) {
  return (
    <div className="space-y-6">
      <SectionIntro
        label="04 · Bridging Sources"
        title="Other credible angles"
        desc="These sources cover the same topic from different vantage points. They are credible, independently reported, and moderately divergent — not the polar opposite of the analyzed content. Reading across these angles is the behavioral intervention."
      />

      {/* Selection criteria */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          {
            icon: '◈',
            label: 'Topic-matched',
            desc: 'Same subject matter as the analyzed content',
            color: 'text-[#6ea8c4]',
            borderColor: 'border-[#6ea8c4]/10',
            bg: 'bg-[#6ea8c4]/[0.02]',
          },
          {
            icon: '◎',
            label: 'Moderately divergent',
            desc: 'Different angle — not a maximum opposite',
            color: 'text-violet-400',
            borderColor: 'border-violet-800/20',
            bg: 'bg-violet-950/[0.03]',
          },
          {
            icon: '◇',
            label: 'Non-dehumanizing',
            desc: 'Credible, civil, independently reported',
            color: 'text-teal-400',
            borderColor: 'border-teal-800/20',
            bg: 'bg-teal-950/[0.03]',
          },
        ].map(item => (
          <div key={item.label} className={`flex items-start gap-3 p-3.5 rounded-xl border ${item.borderColor} ${item.bg}`}>
            <span className={`text-lg font-mono leading-none mt-0.5 ${item.color}`}>{item.icon}</span>
            <div>
              <p className={`text-xs font-semibold ${item.color} mb-0.5`}>{item.label}</p>
              <p className="text-xs text-zinc-600 leading-relaxed">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* No left/right framing note */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/6 bg-white/[0.015]">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600 flex-shrink-0">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className="text-xs text-zinc-600">
          Sources are labeled by <span className="text-zinc-500">angle</span> (economic, legal, scientific…) — not political position. No "left" or "right."
        </p>
      </div>

      {/* Source cards */}
      <div className="space-y-3">
        {sources.map((source, idx) => (
          <BridgingSourceCard key={source.id} source={source} idx={idx} />
        ))}
      </div>
    </div>
  );
}

function BridgingSourceCard({ source, idx }: { source: BridgingSource; idx: number }) {
  const tierColor = sourceTierColors[source.tier];
  const qualityConfig = evidenceQualityConfig[source.evidenceQuality];
  const angleIcon = angleIcons[source.angle];

  return (
    <div className="p-5 rounded-xl border border-white/8 bg-[#161922]/70 space-y-4 card-hover group transition-all duration-200 hover:bg-[#161922]">
      {/* Top row */}
      <div className="flex items-start gap-3 justify-between">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Index */}
          <span className="mt-1 w-5 h-5 flex-shrink-0 flex items-center justify-center text-xs font-mono text-zinc-700 border border-white/8 bg-white/[0.02] rounded">
            {String(idx + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0 space-y-2">
            {/* Angle label */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 text-xs font-mono text-zinc-500">
                {angleIcon && <span className="opacity-60">{angleIcon}</span>}
                {source.angle}
              </span>
              <span className="text-zinc-800">·</span>
              <span className={`tag px-2 py-0.5 rounded border ${tierColor}`}>{source.tierLabel}</span>
            </div>
            {/* Title */}
            <h3 className="text-sm font-semibold text-[#e2e4e9] leading-snug group-hover:text-[#6ea8c4] transition-colors">
              {source.title}
            </h3>
          </div>
        </div>

        {/* External link */}
        <a
          href={source.url}
          className="flex-shrink-0 w-7 h-7 rounded-lg border border-white/8 bg-white/[0.02] flex items-center justify-center text-zinc-600 hover:text-[#6ea8c4] hover:border-[#6ea8c4]/25 transition-all"
          title="View source"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 text-xs font-mono text-zinc-600 pl-8">
        <span className="text-zinc-500">{source.outlet}</span>
        <span className="text-zinc-800">·</span>
        <span>{source.publishedDate}</span>
        <span className="text-zinc-800">·</span>
        <span className={qualityConfig.color}>{qualityConfig.label}</span>
      </div>

      {/* Why included + Frame difference */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-8">
        <div className="space-y-1.5">
          <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Why included</p>
          <p className="text-xs text-zinc-500 leading-relaxed">{source.whyIncluded}</p>
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">Frame difference</p>
          <p className="text-xs text-zinc-500 leading-relaxed">{source.frameDifference}</p>
        </div>
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
