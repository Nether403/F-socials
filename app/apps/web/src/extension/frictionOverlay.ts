/**
 * Extension friction overlay renderer — vanilla DOM, framework-light to match
 * the extension's existing approach (no React in the content-script surface).
 *
 * Intensity-driven rendering (Req 3.2–3.4, 3.8):
 *   subtle      — non-blocking badge ≤ 32×32 px adjacent to the feed item
 *   moderate    — inline card with the highest-severity framing signal + evidence
 *                 summary; feed-item interactive elements stay operable
 *   interruptive— obscuring overlay that hides the feed item's content until the
 *                 reader dismisses (reveal) or expands (open report) it
 *
 * Lens, not judge: this renderer only displays the verbatim text the API projected
 * (technique / quote / explanation / evidence-strength label / reportUrl). It never
 * synthesizes a verdict, score, or creator rating.
 *
 * Accessibility (Req 16.x): ARIA roles/names on every control, a polite live region
 * announcing presence, a visible ≥2px focus indicator, focus return to the feed item
 * on dismiss, and a focus trap while interruptive.
 */

import type { FrictionOverlayData, FrictionSignal, FrictionEvidenceItem } from './frictionClient';
import type { Intensity } from './frictionModule';

// ─── Labels (color-never-alone + honest-none) ───────────────────────────────

const SEVERITY_LABEL: Record<FrictionSignal['severity'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// Distinct hues, but every one is always paired with the text label above (Req 16.3).
const SEVERITY_COLOR: Record<FrictionSignal['severity'], string> = {
  high: '#b42318',
  medium: '#b54708',
  low: '#475467',
};

const EVIDENCE_LABEL: Record<FrictionEvidenceItem['evidenceStrength'], string> = {
  none: 'no external review found', // honest-none (Req 4.4) — never a true/false word
  weak: 'weak evidence',
  moderate: 'moderate evidence',
  strong: 'strong evidence',
};

const FOCUS_OUTLINE = '2px solid #1d4ed8'; // ≥2 css-px visible focus indicator (Req 16.2)

const ROOT_CLASS = 'f-socials-friction-overlay';

// ─── Public API ──────────────────────────────────────────────────────────────

export interface RenderOptions {
  intensity: Intensity;
  /** Defaults to the global document; injectable for tests. */
  doc?: Document;
  /** Notified after the overlay is dismissed (interruptive content revealed). */
  onDismiss?: () => void;
}

export interface OverlayHandle {
  /** The overlay root element appended to the feed item. */
  readonly element: HTMLElement;
  /** Remove the overlay and restore any obscured feed content. */
  destroy(): void;
}

/**
 * Render a friction overlay onto a feed item. Synchronous so it completes well
 * within the 500 ms budget (Req 2.5). Returns a handle for teardown.
 */
export function renderFrictionOverlay(
  feedItem: HTMLElement,
  data: FrictionOverlayData,
  opts: RenderOptions,
): OverlayHandle {
  const doc = opts.doc ?? feedItem.ownerDocument ?? globalThis.document;
  const intensity = opts.intensity;

  const root = doc.createElement('div');
  root.className = `${ROOT_CLASS} ${ROOT_CLASS}--${intensity}`;
  root.dataset.intensity = intensity;
  // role=region with an accessible name groups the overlay for AT.
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'f-Socials framing context');
  root.style.boxSizing = 'border-box';
  root.style.fontFamily = 'system-ui, sans-serif';
  root.style.fontSize = '14px';
  root.style.lineHeight = '1.4';
  root.style.color = '#101828';

  // Polite live region announces presence without stealing focus (Req 16.4).
  const live = doc.createElement('div');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.style.position = 'absolute';
  live.style.width = '1px';
  live.style.height = '1px';
  live.style.overflow = 'hidden';
  live.style.clip = 'rect(0 0 0 0)';
  live.style.whiteSpace = 'nowrap';
  root.appendChild(live);

  // Track what we obscured so destroy() can restore it exactly.
  const obscured: Array<{ el: HTMLElement; prevVisibility: string }> = [];

  function restoreContent(): void {
    for (const { el, prevVisibility } of obscured) {
      el.style.visibility = prevVisibility;
    }
    obscured.length = 0;
  }

  function dismiss(): void {
    restoreContent();
    cleanupTrap();
    root.remove();
    // Return focus to the triggering feed item within 100 ms (Req 16.5).
    if (!feedItem.hasAttribute('tabindex')) {
      feedItem.setAttribute('tabindex', '-1');
    }
    try { feedItem.focus(); } catch { /* focus is best-effort */ }
    opts.onDismiss?.();
  }

  function openReport(): void {
    // "learn more" / expand → open the full report in a new tab (Req 2.6, 3.8).
    try {
      globalThis.open?.(data.reportUrl, '_blank', 'noopener,noreferrer');
    } catch { /* popup blocked — nothing else to do, no error UI */ }
  }

  // ── Focus trap (interruptive only, Req 16.7) ──────────────────────────────
  let trapHandler: ((e: KeyboardEvent) => void) | null = null;
  function focusable(): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>('a[href], button, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !el.hasAttribute('disabled'));
  }
  function installTrap(): void {
    trapHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', trapHandler);
  }
  function cleanupTrap(): void {
    if (trapHandler) {
      root.removeEventListener('keydown', trapHandler);
      trapHandler = null;
    }
  }

  // ── Build per-intensity body ──────────────────────────────────────────────
  if (intensity === 'subtle') {
    buildSubtle(doc, root, openReport);
    live.textContent = 'f-Socials framing context available for this item.';
  } else {
    // moderate + interruptive share the card body; interruptive adds obscuring.
    const topSignal = data.framingSignals[0]; // highest-severity-first from server
    buildCard(doc, root, data, topSignal, { interruptive: intensity === 'interruptive' }, {
      onDismiss: dismiss,
      onExpand: openReport,
      onLearnMore: openReport,
    });

    if (intensity === 'interruptive') {
      // Obscure the feed item's existing content until dismiss/expand (Req 3.4).
      for (const child of Array.from(feedItem.children) as HTMLElement[]) {
        obscured.push({ el: child, prevVisibility: child.style.visibility });
        child.style.visibility = 'hidden';
      }
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.style.position = 'relative';
      root.style.zIndex = '2147483647';
    }
    live.textContent = 'f-Socials framing context shown for this item.';
  }

  feedItem.appendChild(root);

  if (intensity === 'interruptive') {
    installTrap();
    // Move focus into the overlay so the trap is meaningful and keyboard users
    // land on actionable controls.
    const first = focusable()[0];
    first?.focus();
  }

  return {
    element: root,
    destroy() {
      restoreContent();
      cleanupTrap();
      root.remove();
    },
  };
}

// ─── Builders ─────────────────────────────────────────────────────────────────

function buildSubtle(doc: Document, root: HTMLElement, onActivate: () => void): void {
  // Non-blocking badge ≤ 32×32 px (Req 3.2). It is a button so it is reachable
  // and activatable by keyboard (Req 16.1, 16.2).
  const badge = doc.createElement('button');
  badge.type = 'button';
  badge.textContent = 'ƒ';
  badge.setAttribute('aria-label', 'f-Socials framing context — open full report');
  badge.style.width = '32px';
  badge.style.height = '32px';
  badge.style.maxWidth = '32px';
  badge.style.maxHeight = '32px';
  badge.style.borderRadius = '50%';
  badge.style.border = 'none';
  badge.style.background = '#1d4ed8';
  badge.style.color = '#ffffff';
  badge.style.fontWeight = '700';
  badge.style.cursor = 'pointer';
  badge.style.display = 'inline-flex';
  badge.style.alignItems = 'center';
  badge.style.justifyContent = 'center';
  applyFocusRing(badge);
  badge.addEventListener('click', onActivate);
  root.appendChild(badge);

  // The badge itself is non-blocking: positioned adjacent, not over content.
  root.style.position = 'absolute';
  root.style.top = '4px';
  root.style.right = '4px';
}

function buildCard(
  doc: Document,
  root: HTMLElement,
  data: FrictionOverlayData,
  topSignal: FrictionSignal | undefined,
  flags: { interruptive: boolean },
  actions: { onDismiss: () => void; onExpand: () => void; onLearnMore: () => void },
): void {
  root.style.display = 'block';
  root.style.margin = flags.interruptive ? '0' : '8px 0';
  root.style.padding = '12px 14px';
  root.style.border = '1px solid #d0d5dd';
  root.style.borderRadius = '8px';
  root.style.background = '#ffffff';

  // Heading — text label, not color-only (Req 16.3).
  const heading = doc.createElement('h2');
  heading.textContent = 'Framing context';
  heading.style.margin = '0 0 8px';
  heading.style.fontSize = '15px';
  heading.style.fontWeight = '700';
  root.appendChild(heading);

  // Highest-severity framing signal (Req 3.3).
  if (topSignal) {
    const sig = doc.createElement('div');
    sig.style.marginBottom = '10px';

    const techRow = doc.createElement('p');
    techRow.style.margin = '0 0 4px';

    // Severity pill: color + adjacent text label (color-never-alone, Req 16.3).
    const pill = doc.createElement('span');
    pill.textContent = SEVERITY_LABEL[topSignal.severity];
    pill.style.display = 'inline-block';
    pill.style.padding = '1px 8px';
    pill.style.marginRight = '8px';
    pill.style.borderRadius = '10px';
    pill.style.background = SEVERITY_COLOR[topSignal.severity];
    pill.style.color = '#ffffff';
    pill.style.fontSize = '12px';
    pill.style.fontWeight = '700';
    // Make the meaning explicit to AT, not just the visual.
    pill.setAttribute('aria-label', `Severity: ${SEVERITY_LABEL[topSignal.severity]}`);
    techRow.appendChild(pill);

    const tech = doc.createElement('strong');
    tech.textContent = topSignal.technique;
    techRow.appendChild(tech);
    sig.appendChild(techRow);

    if (topSignal.quote) {
      const quote = doc.createElement('blockquote');
      quote.textContent = topSignal.quote;
      quote.style.margin = '0 0 4px';
      quote.style.padding = '4px 8px';
      quote.style.borderLeft = '3px solid #d0d5dd';
      quote.style.color = '#344054';
      sig.appendChild(quote);
    }

    if (topSignal.explanation) {
      const expl = doc.createElement('p');
      expl.textContent = topSignal.explanation;
      expl.style.margin = '0';
      expl.style.color = '#344054';
      sig.appendChild(expl);
    }

    root.appendChild(sig);
  }

  // Evidence summary (Req 2.2, 4.4). Labels only — never a truth verdict.
  if (data.evidenceSummary.length > 0) {
    const evLabel = doc.createElement('h3');
    evLabel.textContent = 'Evidence summary';
    evLabel.style.margin = '0 0 4px';
    evLabel.style.fontSize = '13px';
    evLabel.style.fontWeight = '700';
    root.appendChild(evLabel);

    const list = doc.createElement('ul');
    list.style.margin = '0 0 10px';
    list.style.paddingLeft = '18px';
    for (const item of data.evidenceSummary) {
      const li = doc.createElement('li');
      li.style.marginBottom = '2px';
      const claim = doc.createElement('span');
      claim.textContent = item.claimText;
      const strength = doc.createElement('span');
      strength.textContent = ` — ${EVIDENCE_LABEL[item.evidenceStrength]}`;
      strength.style.color = '#475467';
      strength.style.fontStyle = 'italic';
      li.appendChild(claim);
      li.appendChild(strength);
      list.appendChild(li);
    }
    root.appendChild(list);
  }

  // Actions row.
  const actionsRow = doc.createElement('div');
  actionsRow.style.display = 'flex';
  actionsRow.style.gap = '12px';
  actionsRow.style.alignItems = 'center';
  actionsRow.style.flexWrap = 'wrap';

  // "learn more" link → reportUrl in a new tab (Req 2.6).
  const learnMore = doc.createElement('a');
  learnMore.href = data.reportUrl;
  learnMore.target = '_blank';
  learnMore.rel = 'noopener noreferrer';
  learnMore.textContent = 'Learn more';
  learnMore.setAttribute('aria-label', 'Learn more — open the full report in a new tab');
  learnMore.style.color = '#1d4ed8';
  learnMore.style.fontWeight = '600';
  learnMore.style.textDecoration = 'underline';
  applyFocusRing(learnMore);
  // Anchor handles the new-tab open natively; also notify the handler for testability.
  learnMore.addEventListener('click', () => actions.onLearnMore());
  actionsRow.appendChild(learnMore);

  if (flags.interruptive) {
    // Interruptive requires an explicit dismiss (reveal) and expand (open) (Req 3.8).
    const expand = doc.createElement('button');
    expand.type = 'button';
    expand.textContent = 'Open report';
    expand.setAttribute('aria-label', 'Open the full report in a new tab');
    styleButton(expand, true);
    expand.addEventListener('click', () => actions.onExpand());
    actionsRow.appendChild(expand);

    const dismiss = doc.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss this context and show the feed item');
    styleButton(dismiss, false);
    dismiss.addEventListener('click', () => actions.onDismiss());
    actionsRow.appendChild(dismiss);
  }

  root.appendChild(actionsRow);
}

// ─── Styling helpers ───────────────────────────────────────────────────────────

function styleButton(btn: HTMLButtonElement, primary: boolean): void {
  btn.style.padding = '6px 12px';
  btn.style.borderRadius = '6px';
  btn.style.fontWeight = '600';
  btn.style.cursor = 'pointer';
  if (primary) {
    btn.style.border = 'none';
    btn.style.background = '#1d4ed8';
    btn.style.color = '#ffffff';
  } else {
    btn.style.border = '1px solid #98a2b3';
    btn.style.background = '#ffffff';
    btn.style.color = '#101828';
  }
  applyFocusRing(btn);
}

function applyFocusRing(el: HTMLElement): void {
  // Visible focus indicator ≥ 2 css-px (Req 16.2).
  el.addEventListener('focus', () => {
    el.style.outline = FOCUS_OUTLINE;
    el.style.outlineOffset = '2px';
  });
  el.addEventListener('blur', () => {
    el.style.outline = '';
    el.style.outlineOffset = '';
  });
}
