import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  HelpCircle,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import type {
  AnalysisReport,
  Claim,
  EvidenceStrength,
  FramingExample,
  SourceTier,
  Verifiability,
} from '../api/types';

// Neutral, non-verdict mapping: evidenceStrength = how much external review exists.
const STRENGTH: Record<EvidenceStrength, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
  strong: { label: 'Well-sourced', cls: 'teal', Icon: ShieldCheck },
  moderate: { label: 'Sourced', cls: 'info', Icon: FileText },
  weak: { label: 'Lightly sourced', cls: 'amber', Icon: AlertTriangle },
  none: { label: 'No external review', cls: 'muted', Icon: HelpCircle },
};

const VERIFIABILITY: Record<Verifiability, string> = {
  verifiable: 'Verifiable',
  partially_verifiable: 'Partly verifiable',
  opinion: 'Opinion',
  unverifiable: 'Unverifiable',
};

const TIER: Record<SourceTier, string> = {
  tier1_primary: 'Tier 1 · Primary',
  tier2_institutional: 'Tier 2 · Institutional',
  tier3_viewpoint: 'Tier 3 · Viewpoint',
  excluded: 'Excluded',
};

type Tab = 'claims' | 'framing' | 'context' | 'perspectives';

export function Report({
  report,
  onBack,
  shared,
}: {
  report: AnalysisReport;
  onBack: () => void;
  shared?: boolean;
}) {
  const [tab, setTab] = useState<Tab>('claims');

  return (
    <div>
      <div className="report-head">
        <div>
          <button className="btn btn-ghost" onClick={onBack} style={{ height: 34, padding: '0 12px' }}>
            <ArrowLeft size={15} /> {shared ? 'Analyze your own' : 'Analyze another'}
          </button>
          <h2 className="editorial">{report.title ?? 'Analysis report'}</h2>
          <div className="meta-row">
            {report.issueFrame && <span>Frame: {report.issueFrame.label}</span>}
            <span>{report.claims.length} claims</span>
            <span>{report.framingSignals.length} framing signals</span>
          </div>
        </div>
        {report.shareSlug && <ShareButton slug={report.shareSlug} />}
      </div>

      {report.status === 'needs_review' && (
        <div className="banner">
          This analysis is held for human review{report.reasons?.length ? `: ${report.reasons.join('; ')}` : ''}.
          Showing it transparently rather than hiding it.
        </div>
      )}

      {report.tldr && (
        <div className="card">
          <div className="section-label">Summary</div>
          <p className="tldr">{report.tldr}</p>
        </div>
      )}

      {report.issueFrame && <IssueFrame x={report.issueFrame.x} y={report.issueFrame.y} />}

      <div className="tabs">
        <Tabbtn id="claims" tab={tab} setTab={setTab} label="Claim Ledger" n={report.claims.length} />
        <Tabbtn id="framing" tab={tab} setTab={setTab} label="Framing Signals" n={report.framingSignals.length} />
        <Tabbtn id="context" tab={tab} setTab={setTab} label="Useful Context" n={report.contextCards.length} />
        <Tabbtn id="perspectives" tab={tab} setTab={setTab} label="Other Angles" n={report.perspectives.length} />
      </div>

      {tab === 'claims' && <Claims claims={report.claims} />}
      {tab === 'framing' && <Framing report={report} />}
      {tab === 'context' && <Context cards={report.contextCards} />}
      {tab === 'perspectives' && <Perspectives links={report.perspectives} />}

      {report.provenance && (
        <div className="provenance">
          <span className="tag muted">{report.provenance.reviewStatus.replace('-', ' ')}</span>
          <span>Model: {report.provenance.model}</span>
          <span>Analysis v{report.provenance.analysisVersion}</span>
          <span>Source policy {report.provenance.sourcePolicyVersion}</span>
          <span>Updated {new Date(report.provenance.lastUpdated).toLocaleString()}</span>
          <span>{report.provenance.disputesCount} disputes</span>
        </div>
      )}
    </div>
  );
}

function Tabbtn(props: { id: Tab; tab: Tab; setTab: (t: Tab) => void; label: string; n: number }) {
  return (
    <button className={`tab ${props.tab === props.id ? 'active' : ''}`} onClick={() => props.setTab(props.id)}>
      {props.label} <span className="count">({props.n})</span>
    </button>
  );
}

function ShareButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/#/r/${slug}`;
  return (
    <button
      className="btn btn-ghost"
      style={{ height: 38, padding: '0 14px', flexShrink: 0 }}
      onClick={async () => {
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
      {copied ? <Check size={15} /> : <Share2 size={15} />} {copied ? 'Copied' : 'Share'}
    </button>
  );
}

function IssueFrame({ x, y }: { x: number; y: number }) {
  const pct = (v: number) => `${((Math.max(-1, Math.min(1, v)) + 1) / 2) * 100}%`;
  return (
    <div className="card">
      <div className="section-label">Where it sits (descriptive, not a verdict)</div>
      <div className="spectrum">
        <div className="axis">
          <div className="ends">
            <span>State / collective</span>
            <span>Market / individual</span>
          </div>
          <div className="track">
            <span className="marker" style={{ left: pct(x) }} />
          </div>
        </div>
        <div className="axis">
          <div className="ends">
            <span>Libertarian</span>
            <span>Authoritarian</span>
          </div>
          <div className="track">
            <span className="marker" style={{ left: pct(y) }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Claims({ claims }: { claims: Claim[] }) {
  if (claims.length === 0) return <Empty msg="No claims were extracted." />;
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
  const s = STRENGTH[claim.evidenceStrength];
  return (
    <div className={`claim ${open ? 'open' : ''}`}>
      <div className="claim-head" onClick={() => setOpen((o) => !o)}>
        <span className="claim-num">{num}</span>
        <div className="claim-body">
          <div className="claim-text">{claim.claimText}</div>
          <div className="badge-row">
            <span className={`tag ${s.cls}`}>
              <s.Icon size={12} /> {s.label}
            </span>
            <span className="tag">{VERIFIABILITY[claim.verifiability]}</span>
          </div>
        </div>
        <ChevronDown className="chev" size={18} />
      </div>
      {open && (
        <div className="drawer">
          {claim.transcriptSpan && (
            <div>
              <div className="sub">What was said</div>
              <div className="quote">“{claim.transcriptSpan}”</div>
            </div>
          )}
          {(claim.evidenceDescription || claim.sourceBasis) && (
            <div>
              <div className="sub">Evidence review</div>
              <div>{claim.evidenceDescription ?? claim.sourceBasis}</div>
            </div>
          )}
          <div>
            <div className="sub">
              Sources {claim.citations.length === 0 && '— none found (treat with caution)'}
            </div>
            {claim.citations.map((cit, i) => (
              <a key={i} className="citation" href={cit.sourceUrl} target="_blank" rel="noreferrer">
                <div>
                  <div>{cit.excerpt ?? cit.sourceName}</div>
                  <div className="name">
                    {cit.sourceName} · {TIER[cit.sourceTier]}
                    {cit.supports === false ? ' · contradicts' : cit.supports === true ? ' · supports' : ''}
                  </div>
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

function Framing({ report }: { report: AnalysisReport }) {
  const [active, setActive] = useState(0);
  if (report.framingSignals.length === 0) return <Empty msg="No framing signals detected." />;
  const selected = report.framingSignals[active];
  return (
    <div className="framing-layout">
      <div>
        {report.framingSignals.map((sig, i) => (
          <div key={i} className={`signal ${i === active ? 'active' : ''}`} onClick={() => setActive(i)}>
            <div className="row">
              <h4>{sig.technique}</h4>
              <span className={`tag ${sig.severity === 'high' ? 'amber' : sig.severity === 'medium' ? 'info' : 'muted'}`}>
                {sig.severity} severity
              </span>
            </div>
            <p>{sig.description}</p>
          </div>
        ))}
      </div>
      <div className="transcript">
        {report.transcript
          ? renderTranscript(report.transcript, selected?.examples ?? [])
          : 'Transcript not available.'}
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
    out.push(
      <mark key={i} title={e.explanation}>
        {transcript.slice(e.startIndex, e.endIndex)}
      </mark>,
    );
    last = e.endIndex;
  });
  if (last < transcript.length) out.push(transcript.slice(last));
  return out;
}

function Context({ cards }: { cards: AnalysisReport['contextCards'] }) {
  if (cards.length === 0) return <Empty msg="No notable omissions flagged." />;
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
  if (links.length === 0) return <Empty msg="No bridging perspectives found." />;
  return (
    <div className="grid-2">
      {links.map((p, i) => (
        <div key={i} className="mini-card">
          <div className="badge-row" style={{ marginBottom: 6 }}>
            <span className="tag info">{p.issueFrameLabel}</span>
            <span className="tag muted">{TIER[p.sourceTier]}</span>
          </div>
          <h4>{p.sourceName}</h4>
          {p.whyIncluded && <p>{p.whyIncluded}</p>}
          <div className="diverge" title={`divergence ${p.divergence.toFixed(2)}`}>
            <i style={{ width: `${Math.round(p.divergence * 100)}%` }} />
          </div>
          <a className="src" href={p.url} target="_blank" rel="noreferrer">
            Read this angle <ExternalLink size={13} />
          </a>
        </div>
      ))}
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
