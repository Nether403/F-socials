interface NavItem {
  id: string;
  label: string;
  sublabel: string;
  count?: number;
  color?: string;
}

const navItems: NavItem[] = [
  {
    id: 'analyzed-content',
    label: 'Overview',
    sublabel: 'Summary & metadata',
  },
  {
    id: 'claim-ledger',
    label: 'Claim Ledger',
    sublabel: 'What it says',
    count: 5,
    color: 'text-sky-400',
  },
  {
    id: 'framing-signals',
    label: 'Framing Signals',
    sublabel: 'How it is framed',
    count: 4,
    color: 'text-amber-400',
  },
  {
    id: 'related-context',
    label: 'Related Context',
    sublabel: 'Useful context',
    count: 4,
    color: 'text-teal-400',
  },
  {
    id: 'bridging-sources',
    label: 'Bridging Sources',
    sublabel: 'Other credible angles',
    count: 5,
    color: 'text-violet-400',
  },
  {
    id: 'provenance',
    label: 'Provenance',
    sublabel: 'How this was produced',
  },
];

interface SideNavProps {
  activeSection: string;
}

export default function SideNav({ activeSection }: SideNavProps) {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const y = el.getBoundingClientRect().top + window.pageYOffset - 88;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  return (
    <nav className="space-y-0.5">
      <div className="flex items-center justify-between px-2 pb-3">
        <p className="text-[10px] font-mono text-zinc-700 uppercase tracking-widest">Report sections</p>
        <p className="text-[10px] font-mono text-zinc-700">6</p>
      </div>

      {navItems.map((item, idx) => {
        const isActive = activeSection === item.id;
        return (
          <button
            key={item.id}
            onClick={() => scrollTo(item.id)}
            className={`w-full text-left px-3 py-2.5 rounded-lg transition-all duration-150 group relative border-l-2 ${
              isActive
                ? 'border-[#6ea8c4] bg-gradient-to-r from-[#6ea8c4]/8 to-transparent'
                : 'border-transparent hover:bg-white/[0.025] hover:border-white/10'
            }`}
          >
            {/* Section number */}
            {idx > 0 && (
              <span className="absolute right-3 top-2.5 text-[10px] font-mono text-zinc-800">
                {String(idx).padStart(2, '0')}
              </span>
            )}

            <div className="flex items-center justify-between pr-6">
              <span className={`text-sm font-medium transition-colors leading-tight ${
                isActive ? 'text-[#6ea8c4]' : 'text-zinc-400 group-hover:text-zinc-200'
              }`}>
                {item.label}
              </span>
              {item.count && (
                <span className={`text-xs font-mono ${
                  isActive ? item.color || 'text-[#6ea8c4]' : 'text-zinc-700'
                }`}>
                  {item.count}
                </span>
              )}
            </div>
            <p className={`text-xs mt-0.5 transition-colors ${
              isActive ? 'text-[#6ea8c4]/50' : 'text-zinc-700 group-hover:text-zinc-600'
            }`}>
              {item.sublabel}
            </p>
          </button>
        );
      })}
    </nav>
  );
}
