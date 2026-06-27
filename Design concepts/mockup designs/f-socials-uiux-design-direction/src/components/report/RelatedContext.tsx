import { ContextItem } from '../../data/reportData';

interface RelatedContextProps {
  items: ContextItem[];
}

const angleColors: Record<string, string> = {
  'empirical / comparative': 'text-teal-300 bg-teal-950/40 border-teal-800/30',
  'policy / competitive markets': 'text-sky-300 bg-sky-950/40 border-sky-800/30',
  'legal / legislative': 'text-violet-300 bg-violet-950/40 border-violet-800/30',
  'economic / academic': 'text-amber-300 bg-amber-950/40 border-amber-800/30',
};

export default function RelatedContext({ items }: RelatedContextProps) {
  return (
    <div className="space-y-5">
      <SectionIntro
        label="03 · Related Context"
        title="Useful context"
        desc="Other reporting and research on the same topics. These items are not corrections — they are additional information that appears in coverage of this subject area."
      />

      <div className="space-y-3">
        {items.map((item) => (
          <ContextCard key={item.id} item={item} />
        ))}
      </div>

      {/* Methodology note */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-white/6 bg-white/[0.015]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600 flex-shrink-0 mt-0.5">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <p className="text-xs text-zinc-600 leading-relaxed">
          Context items are selected based on topical relevance to claims identified in the analyzed content.
          They represent additional available reporting — not omissions by the original author.
        </p>
      </div>
    </div>
  );
}

function ContextCard({ item }: { item: ContextItem }) {
  const angleColor = angleColors[item.angle] || 'text-zinc-400 bg-zinc-800/40 border-zinc-700/30';

  return (
    <div className="p-5 rounded-xl border border-white/8 bg-[#161922]/60 space-y-3 card-hover group">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`tag px-2 py-0.5 rounded border ${angleColor}`}>
              {item.angle}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-[#e2e4e9] leading-snug group-hover:text-[#6ea8c4] transition-colors">
            {item.headline}
          </h3>
        </div>
        <a
          href={item.url}
          className="flex-shrink-0 w-7 h-7 rounded-lg border border-white/8 bg-white/[0.02] flex items-center justify-center text-zinc-600 hover:text-[#6ea8c4] hover:border-[#6ea8c4]/30 transition-all"
          title="View source"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>

      {/* Snippet */}
      <p className="text-sm text-zinc-400 leading-relaxed border-l-2 border-white/8 pl-3 italic">
        {item.snippet}
      </p>

      {/* Meta */}
      <div className="flex items-center gap-2 text-xs font-mono text-zinc-600">
        <span className="text-zinc-500">{item.outlet}</span>
        <span>·</span>
        <span>{item.publishedDate}</span>
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
