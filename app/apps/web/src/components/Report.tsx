import { useState, useRef, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Flag,
  HelpCircle,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import type {
  AnalysisReport,
  Claim,
  EvidenceStrength,
  FramingExample,
  FramingSignal,
  SourceTier,
} from '../api/types';
import { AuthExpiredError, saveReport, submitFlag } from '../api/client';
import type { GatedControl, UseSession } from '../auth/useSession';
import { track } from '../analytics';
import { useT, useFmt } from '../i18n/context';
import { DisputeModal } from './DisputeModal';
import { SummaryLead } from './SummaryLead';
import { DisclosureSection } from './DisclosureSection';
import { RationaleBlock } from './RationaleBlock';
import { CoverageAngleNote } from './CoverageAngleNote';
import { IssueFrameChip } from './IssueFrameChip';
import { SourceTierChip } from './SourceTierChip';
import { claimRationale, sectionCounts } from './reportView';

// Neutral, non-verdict mapping: evidenceStrength = how much external review exists.
// ponytail: label text removed — resolved at render time via t('report.strength.' + s).
const STRENGTH: Record<EvidenceStrength, { cls: string; Icon: typeof ShieldCheck }> = {
  strong: { cls: 'teal', Icon: ShieldCheck },
  moderate: { cls: 'info', Icon: FileText },
  weak: { cls: 'amber', Icon: AlertTriangle },
  none: { cls: 'muted', Icon: HelpCircle },
};

// ponytail: verifiability labels resolved at render time via t('report.verifiability.' + v).

// ponytail: TIER kept as an export for SourceTierChip compatibility; within Report.tsx
// the tier label resolves at render time via t('report.tier.' + tier).
export const TIER: Record<SourceTier, string> = {
  tier1_primary: 'Tier 1 · Primary',
  tier2_institutional: 'Tier 2 · Institutional',
  tier3_viewpoint: 'Tier 3 · Viewpoint',
  excluded: 'Excluded',
};

// --- Accessibility helpers (color-never-alone + screen-reader text) ---------

const clamp = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

// Map a coordinate in [-1, 1] to a phrase relative to its two poles.
// Total over every real number, so every issue-frame position has text (Property 13, Req 4.9).
export function issueFrameAxisText(v: number, lowLabel: string, highLabel: string): string {
  const c = clamp(v);
  const mag = Math.abs(c);
  if (mag <= 0.12) return `centered between ${lowLabel} and ${highLabel}`;
  const intensity = mag <= 0.45 ? 'slightly' : mag <= 0.8 ? 'moderately' : 'strongly';
  return `${intensity} toward ${c < 0 ? lowLabel : highLabel}`;
}

// Full, non-empty textual representation of an (x, y) issue-frame position.
export function issueFramePositionText(x: number, y: number): string {
  return (
    `Economic: ${issueFrameAxisText(x, 'state / collective', 'market / individual')}. ` +
    `Governance: ${issueFrameAxisText(y, 'libertarian', 'authoritarian')}.`
  );
}

// Divergence (0..1) as a word + percentage, so the bar's meaning isn't length-only (Req 4.6).
export function divergenceLabel(d: number): string {
  const v = Number.isFinite(d) ? Math.max(0, Math.min(1, d)) : 0;
  const word = v < 0.34 ? 'low' : v < 0.67 ? 'moderate' : 'high';
  return `${word} divergence (${Math.round(v * 100)}%)`;
}

// Localized divergence label using the catalog.
function localizedDivergenceLabel(d: number, t: (key: string, values?: Record<string, string | number>) => string): string {
  const v = Number.isFinite(d) ? Math.max(0, Math.min(1, d)) : 0;
  const magnitude = v < 0.34 ? 'low' : v < 0.67 ? 'moderate' : 'high';
  return t('report.divergence', { word: t('report.divergence.' + magnitude), pct: String(Math.round(v * 100)) });
}

const SEVERITY_RANK: Record<FramingSignal['severity'], number> = { high: 3, medium: 2, low: 1 };

export function severityTagCls(sev: FramingSignal['severity']): string {
  return sev === 'high' ? 'amber' : sev === 'medium' ? 'info' : 'muted';
}

// The single most important framing signal: highest severity, first one wins on ties.
export function topFramingSignal(signals: FramingSignal[]): FramingSignal | undefined {
  return signals.reduce<FramingSignal | undefined>(
    (best, s) => (!best || SEVERITY_RANK[s.severity] > SEVERITY_RANK[best.severity] ? s : best),
    undefined,
  );
}

// A save that does not confirm within 10 seconds is treated as a failure so the
// reader can retry (Req 7.7). ponytail: the underlying fetch is left to settle on
// its own; the upgrade path is an AbortController if we ever need to cancel it.
const SAVE_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function Report({
  report,
  onBack,
  shared,
  session,
  onRequireSignIn,
}: {
  report: AnalysisReport;
  onBack: () => void;
  shared?: boolean;
  // The shared session hook (App owns the single instance). Absent in contexts that
  // render a report without accounts wiring (e.g. isolated tests); treated as
  // Anonymous + not-configured so Save/Flag degrade safely.
  session?: UseSession;
  // Navigate to the sign-in surface. Report records the pending gated action on the
  // session first, so a successful sign-in returns the reader here (Req 6.2, 6.7).
  onRequireSignIn?: () => void;
}) {
  // Dispute_Modal mount seam (Req 3.10).
  const [disputeOpen, setDisputeOpen] = useState(false);
  // Save_Control state (Req 7): `saved` drives the saved indicator, `savePending`
  // disables + debounces the control while in flight (Req 7.6), `saveError` carries
  // the "save did not complete" text (Req 7.7).
  const [saved, setSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Flag_Control state (Req 6): the technique whose flag request is in flight (so we
  // disable just that control, Req 6.5) and the "action not recorded" text (Req 6.6).
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const [flagError, setFlagError] = useState<string | null>(null);
  // The account-features-unavailable notice for the not-configured path (Req 5.3).
  const [unavailable, setUnavailable] = useState<string | null>(null);
  // Opener of the Dispute_Modal, so we can restore focus to it on close (Req 4.7).
  const disputeOpenerRef = useRef<HTMLButtonElement>(null);

  const { t } = useT();
  const { formatDate } = useFmt();
  const token = session?.session?.accessToken ?? null;
  const configured = session?.configured ?? false;

  // Decide whether a gated action (Save/Flag) may proceed. Returns true only when a
  // Session is active (Req 6.1). With no session but Auth_Configured it records the
  // pending control and routes to sign-in, retaining the report context (Req 6.2,
  // 6.7). When not configured it shows the unavailable message and sends nothing
  // (Req 5.3). In every blocked case it returns false so the caller submits nothing.
  function canProceed(control: GatedControl): boolean {
    if (token) return true;
    if (configured) {
      if (session) session.pendingAction.current = { reportId: report.id, control };
      onRequireSignIn?.();
      return false;
    }
    setUnavailable(t('report.accountUnavailable'));
    return false;
  }

  // Save the report to the reader's account (Req 7). Ignores re-activations while a
  // request is pending (Req 7.6). On success shows the saved indicator (Req 7.2); on
  // a 401 the session clears and the app falls back to Anonymous (Req 4.4); on any
  // other failure or a >10s timeout it shows "save did not complete" and re-enables
  // the control for retry without showing the saved indicator (Req 7.7).
  async function onSave() {
    if (savePending) return;
    if (!canProceed('save')) return;
    const accessToken = token!;
    setSavePending(true);
    setSaveError(null);
    setUnavailable(null);
    try {
      await withTimeout(
        saveReport(report.id, accessToken),
        SAVE_TIMEOUT_MS,
        t('report.save.error'),
      );
      track('save', { reportId: report.id }); // Web_Analytics interaction event
      setSaved(true);
    } catch (e) {
      if (e instanceof AuthExpiredError) {
        session?.handleAuthError(e); // 401 → clear session (Req 4.4); no failure text
      } else {
        setSaveError(t('report.save.error')); // Req 7.7
      }
    } finally {
      setSavePending(false); // re-enable for retry on any outcome (Req 7.7)
    }
  }

  // Flag a framing technique (Req 6). Disables the activated control while in flight
  // (Req 6.5) and ignores other flag activations meanwhile. On a 401 the session
  // clears (Req 4.4); any other failure shows "action not recorded" and re-enables
  // the control (Req 6.6). The token is attached on send (Req 6.3, 7.1).
  async function onFlag(technique: string) {
    if (flagBusy) return;
    if (!canProceed('flag')) return;
    const accessToken = token!;
    setFlagBusy(technique);
    setFlagError(null);
    setUnavailable(null);
    try {
      track('flag', { reportId: report.id }); // Web_Analytics interaction event (Req 12.2)
      await submitFlag(report.id, { technique }, accessToken);
    } catch (e) {
      if (e instanceof AuthExpiredError) {
        session?.handleAuthError(e);
      } else {
        setFlagError(t('report.flag.error')); // Req 6.6
      }
    } finally {
      setFlagBusy(null);
    }
  }

  // Per-section item counts surfaced on each drawer control; each equals its collection length
  // (single source of truth, Req 8.2). Read-only — nothing is written back to the report.
  const counts = sectionCounts(report);

  return (
    <div>
      <div className="report-head">
        <div>
          <button className="btn btn-ghost" onClick={onBack} style={{ height: 34, padding: '0 12px' }}>
            <ArrowLeft size={15} /> {shared ? t('report.backAnalyzeOwn') : t('report.backAnalyzeAnother')}
          </button>
          <h2 className="editorial">{report.title ?? t('report.defaultTitle')}</h2>
          <div className="meta-row">
            {report.issueFrame?.label && <IssueFrameChip label={report.issueFrame.label} />}
            <span>{t('report.counts.claims', { n: String(report.claims.length) })}</span>
            <span>{t('report.counts.framingSignals', { n: String(report.framingSignals.length) })}</span>
          </div>
        </div>
        <div className="head-actions">
          <button
            className="btn btn-ghost"
            style={{ height: 38, padding: '0 14px', flexShrink: 0 }}
            onClick={() => void onSave()}
            disabled={savePending}
            aria-pressed={saved}
            aria-busy={savePending}
          >
            {/* Color/icon-never-alone: a visible text label sits beside the icon for
                every state, including "Saved" (Req 7.2, 14.3). */}
            {saved ? <Check size={15} /> : <Bookmark size={15} />}{' '}
            {savePending ? t('report.save.saving') : saved ? t('report.save.saved') : t('report.save')}
          </button>
          {report.shareSlug && <ShareButton slug={report.shareSlug} reportId={report.id} />}
        </div>
      </div>

      {/* Account/action notices for Save and Flag, announced through an ARIA live
          region so assistive tech hears them without a focus change (Req 14.9):
          the not-configured unavailable message (Req 5.3), the "save did not
          complete" text (Req 7.7), and the flag "action not recorded" text (Req 6.6). */}
      <div aria-live="polite" role="status">
        {unavailable && <div className="banner">{unavailable}</div>}
        {saveError && <div className="banner error">{saveError}</div>}
        {flagError && <div className="banner error">{flagError}</div>}
      </div>

      {report.status === 'needs_review' && (
        <div className="banner">
          {report.reasons?.length
            ? t('report.status.needsReviewWithReasons', { reasons: report.reasons.join('; ') })
            : t('report.status.needsReview')}
        </div>
      )}

      {/* Summary_Lead leads the page, expanded before any interaction (Req 1.x). Every other
          section sits behind an independent disclosure drawer, collapsed on first paint (Req 2.1). */}
      <SummaryLead report={report} />

      <DisclosureSection title={t('report.section.claims')} count={counts.claims}>
        <Claims claims={report.claims} />
      </DisclosureSection>

      <DisclosureSection title={t('report.section.framing')} count={counts.framingSignals}>
        <Framing report={report} onFlag={onFlag} flagBusy={flagBusy} />
      </DisclosureSection>

      <DisclosureSection title={t('report.section.context')} count={counts.contextCards}>
        <Context cards={report.contextCards} />
      </DisclosureSection>

      <DisclosureSection title={t('report.section.perspectives')} count={counts.perspectives}>
        {/* Descriptive "covered from one angle" note (Req 4.x); reads report.issueFrame and
            whether any bridging perspectives exist. Renders nothing on honest absence. */}
        <CoverageAngleNote issueFrame={report.issueFrame} hasPerspectives={report.perspectives.length > 0} />
        <Perspectives links={report.perspectives} />
      </DisclosureSection>

      {/* The issue-frame chart's text-determinable axis positions live behind their own drawer
          (Req 2.1, 5.5); omitted entirely when the report carries no issue frame. */}
      {report.issueFrame && (
        <DisclosureSection title={t('report.section.issueFrame')}>
          <IssueFrameView x={report.issueFrame.x} y={report.issueFrame.y} />
        </DisclosureSection>
      )}

      {report.provenance && (
        <div className="provenance">
          <span className="tag muted">{t('report.readiness.' + report.provenance.reviewStatus.replace('-', '_'))}</span>
          <span>{t('report.provenance.model', { model: report.provenance.model })}</span>
          <span>{t('report.provenance.analysisVersion', { version: report.provenance.analysisVersion })}</span>
          <span>{t('report.provenance.sourcePolicyVersion', { version: report.provenance.sourcePolicyVersion })}</span>
          <span>{t('report.provenance.updated', { date: formatDate(report.provenance.lastUpdated) })}</span>
          <span>{t('report.provenance.disputes', { n: String(report.provenance.disputesCount) })}</span>
          {/* Methodology link → no-auth #/methodology page served by App.tsx (Req 1.7, 1.11). */}
          <a className="prov-action" href="#/methodology">
            {t('report.provenance.methodology')}
          </a>
          {/* Opens the Dispute_Modal (Req 3.10); focus returns here on close (4.7). */}
          <button
            ref={disputeOpenerRef}
            type="button"
            className="prov-action"
            onClick={() => setDisputeOpen(true)}
          >
            {t('report.dispute')}
          </button>
        </div>
      )}

      {disputeOpen && (
        <DisputeModal
          reportId={report.id}
          onClose={() => {
            setDisputeOpen(false);
            disputeOpenerRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function ShareButton({ slug, reportId }: { slug: string; reportId: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useT();
  const link = `${window.location.origin}/#/r/${slug}`;
  return (
    <button
      className="btn btn-ghost"
      style={{ height: 38, padding: '0 14px', flexShrink: 0 }}
      onClick={async () => {
        track('share', { reportId }); // Web_Analytics interaction event (Req 12.2)
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          /* clipboard may be blocked; the link is still in the title */
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      title={link}
    >
      {copied ? <Check size={15} /> : <Share2 size={15} />} {copied ? t('report.share.copied') : t('report.share')}
    </button>
  );
}

function IssueFrameView({ x, y }: { x: number; y: number }) {
  const { t } = useT();
  const pct = (v: number) => `${((Math.max(-1, Math.min(1, v)) + 1) / 2) * 100}%`;
  const econLow = t('report.issueFrame.economic.low');
  const econHigh = t('report.issueFrame.economic.high');
  const govLow = t('report.issueFrame.governance.low');
  const govHigh = t('report.issueFrame.governance.high');
  const xText = issueFrameAxisText(x, econLow, econHigh);
  const yText = issueFrameAxisText(y, govLow, govHigh);
  return (
    <div className="card">
      <div className="section-label">{t('report.issueFrame.heading')}</div>
      <div className="spectrum">
        <div className="axis">
          <div className="ends">
            <span>{econLow}</span>
            <span>{econHigh}</span>
          </div>
          <div className="track">
            <span className="marker" style={{ left: pct(x) }} role="img" aria-label={xText} />
          </div>
          <div className="axis-pos">{xText}</div>
        </div>
        <div className="axis">
          <div className="ends">
            <span>{govLow}</span>
            <span>{govHigh}</span>
          </div>
          <div className="track">
            <span className="marker" style={{ left: pct(y) }} role="img" aria-label={yText} />
          </div>
          <div className="axis-pos">{yText}</div>
        </div>
      </div>
    </div>
  );
}

function Claims({ claims }: { claims: Claim[] }) {
  const { t } = useT();
  if (claims.length === 0) return <Empty msg={t('report.empty.claims')} />;
  return (
    <div>
      {claims.map((c, i) => (
        <ClaimCard key={c.id} claim={c} num={i + 1} />
      ))}
    </div>
  );
}

function ClaimCard({ claim, num }: { claim: Claim; num: number }) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const s = STRENGTH[claim.evidenceStrength];
  return (
    <div className={`claim ${open ? 'open' : ''}`}>
      <div
        className="claim-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className="claim-num">{num}</span>
        <div className="claim-body">
          <div className="claim-text">{claim.claimText}</div>
          <div className="badge-row">
            <span className={`tag ${s.cls}`}>
              <s.Icon size={12} /> {t('report.strength.' + claim.evidenceStrength)}
            </span>
            <span className="tag">{t('report.verifiability.' + claim.verifiability)}</span>
          </div>
        </div>
        <ChevronDown className="chev" size={18} />
      </div>
      {open && (
        <div className="drawer">
          {claim.transcriptSpan && (
            <div>
              <div className="sub">{t('report.claim.whatWasSaid')}</div>
              <div className="quote">“{claim.transcriptSpan}”</div>
            </div>
          )}
          {/* "Why this is here": evidence description, else source basis, else nothing — verbatim,
              no verdict (Req 3.2, 3.3, 3.4, 3.5). Single source of truth via claimRationale. */}
          <RationaleBlock label={t('report.claim.whyThisIsHere')} text={claimRationale(claim)} />
          <div>
            <div className="sub">
              {claim.citations.length === 0 ? t('report.claim.sourcesNone') : t('report.claim.sources')}
            </div>
            {claim.citations.map((cit, i) => (
              <a key={i} className="citation" href={cit.sourceUrl} target="_blank" rel="noreferrer">
                <div>
                  <div>{cit.excerpt ?? cit.sourceName}</div>
                  <div className="name">
                    {cit.sourceName}
                    {cit.supports === false ? ` · ${t('report.claim.contradicts')}` : cit.supports === true ? ` · ${t('report.claim.supports')}` : ''}
                  </div>
                  {/* Source-tier chip: human-readable label, sources only, never the creator (Req 6.1, 6.3). */}
                  <SourceTierChip tier={cit.sourceTier} />
                </div>
                <ExternalLink size={15} />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Framing({
  report,
  onFlag,
  flagBusy,
}: {
  report: AnalysisReport;
  onFlag: (technique: string) => void;
  // The technique whose flag request is in flight, so its control is disabled until
  // the request completes (Req 6.5); null when no flag is pending.
  flagBusy: string | null;
}) {
  const [active, setActive] = useState(0);
  const { t } = useT();
  if (report.framingSignals.length === 0) return <Empty msg={t('report.empty.framing')} />;
  const selected = report.framingSignals[active];
  return (
    <div className="framing-layout">
      <div>
        {report.framingSignals.map((sig, i) => (
          <div
            key={i}
            className={`signal ${i === active ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={i === active}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              // Only the card itself drives selection; let the inner Flag button handle its own keys.
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                setActive(i);
              }
            }}
          >
            <div className="row">
              <h4>{sig.technique}</h4>
              <span className={`tag ${severityTagCls(sig.severity)}`}>
                {t('report.framing.severity', { severity: sig.severity })}
              </span>
            </div>
            <p>{sig.description}</p>
            <div className="signal-actions">
              <button
                type="button"
                className="flag-btn"
                disabled={flagBusy === sig.technique}
                aria-busy={flagBusy === sig.technique}
                onClick={(e) => {
                  e.stopPropagation(); // don't also toggle the active signal
                  void onFlag(sig.technique);
                }}
              >
                <Flag size={12} /> {flagBusy === sig.technique ? t('report.flag.flagging') : t('report.flag')}
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="transcript">
        {report.transcript
          ? renderTranscript(report.transcript, selected?.examples ?? [])
          : t('report.empty.transcript')}
      </div>
    </div>
  );
}

function renderTranscript(transcript: string, examples: FramingExample[]): ReactNode[] {
  const valid = examples
    .filter((e) => e.startIndex >= 0 && e.endIndex > e.startIndex)
    .sort((a, b) => a.startIndex - b.startIndex);
  const out: ReactNode[] = [];
  let last = 0;
  valid.forEach((e, i) => {
    if (e.startIndex < last) return; // overlapping highlight, skip
    if (e.startIndex > last) out.push(transcript.slice(last, e.startIndex));
    const descId = `framing-desc-${i}`;
    out.push(
      <mark key={i} title={e.explanation} aria-describedby={descId}>
        {transcript.slice(e.startIndex, e.endIndex)}
        <span id={descId} className="sr-only">
          {e.explanation}
        </span>
      </mark>,
    );
    last = e.endIndex;
  });
  if (last < transcript.length) out.push(transcript.slice(last));
  return out;
}

function Context({ cards }: { cards: AnalysisReport['contextCards'] }) {
  const { t } = useT();
  if (cards.length === 0) return <Empty msg={t('report.empty.context')} />;
  return (
    <div className="grid-2">
      {cards.map((c, i) => (
        <div key={i} className="mini-card">
          <h4>{c.title}</h4>
          <p>{c.description}</p>
          {c.sourceUrl && (
            <a className="src" href={c.sourceUrl} target="_blank" rel="noreferrer">
              {c.sourceName ?? 'source'} <ExternalLink size={13} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function Perspectives({ links }: { links: AnalysisReport['perspectives'] }) {
  const { t } = useT();
  if (links.length === 0) return <Empty msg={t('report.empty.perspectives')} />;
  return (
    <div className="grid-2">
      {links.map((p, i) => {
        const divLabel = localizedDivergenceLabel(p.divergence, t);
        return (
          <div key={i} className="mini-card">
            <div className="badge-row" style={{ marginBottom: 6 }}>
              {/* Descriptive spatial chip + source-tier chip — single source of truth, never a verdict
                  and never creator-scoped (Req 5.3, 6.2). Each omits on honest absence. */}
              <IssueFrameChip label={p.issueFrameLabel} />
              <SourceTierChip tier={p.sourceTier} />
            </div>
            <h4>{p.sourceName}</h4>
            <RationaleBlock label={t('report.perspectives.whyIncluded')} text={p.whyIncluded} />
            <div className="diverge" role="img" aria-label={divLabel}>
              <i style={{ width: `${Math.round(Math.max(0, Math.min(1, p.divergence)) * 100)}%` }} />
            </div>
            <div className="diverge-label">{divLabel}</div>
            <a className="src" href={p.url} target="_blank" rel="noreferrer">
              {t('report.perspectives.readAngle')} <ExternalLink size={13} />
            </a>
          </div>
        );
      })}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="mini-card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
      {msg}
    </div>
  );
}
