import { useState, type ReactNode, type JSX } from 'react';
import { ChevronDown } from 'lucide-react';

// Reusable progressive-disclosure drawer, extracted from the proven ClaimCard head
// pattern in Report.tsx so the toggle mechanics (role="button", tabIndex, Enter/Space,
// aria-expanded, rotating chevron) live in one place. Children render only while open,
// so collapsed content is absent from the DOM rather than hidden with CSS.
export function DisclosureSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className={`disclosure ${open ? 'open' : ''}`}>
      <div
        className="disclosure-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault(); // stop Space from scrolling the page
            setOpen((o) => !o);
          }
        }}
      >
        <span className="disclosure-title">{title}</span>
        {count !== undefined && <span className="count">({count})</span>}
        <ChevronDown className="chev" size={18} />
      </div>
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  );
}
