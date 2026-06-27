import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { getPolicy } from '../api/client';
import type { PolicyDescriptor } from '../api/types';

// A glossary term defined on its first use (Requirement 1.10). The definition is
// both visible in-line and exposed to assistive tech via the native <dfn>/title.
function Term({ term, def }: { term: string; def: string }) {
  return (
    <dfn title={def} style={{ fontStyle: 'normal' }}>
      <strong>{term}</strong> <span style={{ color: 'var(--text-2)' }}>({def})</span>
    </dfn>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="section-label">{label}</div>
      {children}
    </div>
  );
}

// The five user-facing Evidence_Outcome values, described at a stable level (1.2).
const EVIDENCE_OUTCOMES: { name: string; meaning: string }[] = [
  {
    name: 'Directly matched fact-check',
    meaning: 'A fact-checking organization has already reviewed this specific claim, and we link to that review.',
  },
  {
    name: 'Matched primary or institutional source',
    meaning: 'A first-party record or an institutional publisher directly addresses the claim.',
  },
  {
    name: 'Relevant context without direct verification',
    meaning: 'We found related material that informs the claim but does not directly confirm or refute it.',
  },
  {
    name: 'No sufficient evidence found',
    meaning: 'A genuine search returned nothing strong enough to cite. We say so plainly rather than guessing.',
  },
  {
    name: 'Not fact-checkable',
    meaning: 'The statement is an opinion, prediction, or value judgment that evidence cannot settle.',
  },
];

// Each review status and what it means for the reader (1.4).
const REVIEW_STATUSES: { name: string; meaning: string }[] = [
  { name: 'ready', meaning: 'The report passed every automated integrity check and is shown as produced.' },
  {
    name: 'needs_review',
    meaning:
      'An automated check held the report for a human look — for example a claim that asserts evidence it cannot cite. We show it transparently and mark it, rather than hiding it.',
  },
  { name: 'failed', meaning: 'The analysis could not be completed; no report is shown.' },
];

export function Methodology({ onBack }: { onBack: () => void }) {
  // null while loading; PolicyDescriptor on success; 'unavailable' if the fetch fails.
  const [policy, setPolicy] = useState<PolicyDescriptor | 'unavailable' | null>(null);

  useEffect(() => {
    let alive = true;
    // On /policy fetch failure we degrade gracefully (1.12): the page still renders,
    // with a neutral "policy version unavailable" note in place of the live version.
    getPolicy()
      .then((p) => alive && setPolicy(p))
      .catch(() => alive && setPolicy('unavailable'));
    return () => {
      alive = false;
    };
  }, []);

  const policyData = policy && policy !== 'unavailable' ? policy : null;
  const versionNote =
    policy === null
      ? 'Loading current policy version…'
      : policyData
        ? `Current source-policy version: ${policyData.version}`
        : 'Policy version unavailable.';

  return (
    <div>
      <div className="report-head">
        <div>
          <button className="btn btn-ghost" onClick={onBack} style={{ height: 34, padding: '0 12px' }}>
            <ArrowLeft size={15} /> Back
          </button>
          <h2 className="editorial">How f-Socials works</h2>
          <div className="meta-row">
            <span>A plain-language explanation of our method.</span>
          </div>
        </div>
      </div>

      <Section label="What f-Socials is">
        <p>
          <Term
            term="f-Socials"
            def="a content-analysis system that produces inspectable reports from media you paste in"
          />{' '}
          is a lens, not a judge. Every result is an{' '}
          <Term
            term="Analysis Report"
            def="the full report for one analyzed item — its claims, framing, context, perspectives, and provenance"
          />{' '}
          that helps you inspect how content is built. It never declares a piece of content true or false.
        </p>
      </Section>

      <Section label="How we judge a claim's evidence">
        <p>
          For each claim we report an{' '}
          <Term
            term="Evidence Outcome"
            def="the qualitative result of checking a claim's evidence"
          />
          . We distinguish these outcomes:
        </p>
        <ul>
          {EVIDENCE_OUTCOMES.map((o) => (
            <li key={o.name} style={{ marginBottom: 6 }}>
              <strong>{o.name}.</strong> {o.meaning}
            </li>
          ))}
        </ul>
        <p>
          <strong>What raises confidence:</strong> a direct match to a fact-check or primary record, multiple
          independent sources that agree, and higher-tier sources.{' '}
          <strong>What lowers it:</strong> no citable source, sources that only provide background, or
          sources that disagree with each other. When evidence is absent we record an honest{' '}
          <em>“no external review”</em> rather than implying a verdict.
        </p>
      </Section>

      <Section label="How we rate sources">
        <p>
          The{' '}
          <Term
            term="Source Tier Policy"
            def="our transparent, versioned classification of source reliability"
          />{' '}
          assigns every{' '}
          <Term
            term="Citation"
            def="a source reference attached to a claim, with its URL, name, and tier"
          />{' '}
          exactly one{' '}
          <Term
            term="Source Tier"
            def="a reliability classification of a single source"
          />
          . Tiers are derived only from{' '}
          <Term
            term="Open Signals"
            def="freely and commercially usable reliability signals such as IFCN signatory lists, domain registries, and press-council membership"
          />{' '}
          — never from commercially-encumbered rating datasets, and never attached to a content creator. A{' '}
          <Term
            term="Source Chip"
            def="the UI element that shows a citation's tier label"
          />{' '}
          shows only the tier of a source, never a label about a person who made the content.
        </p>

        {policyData ? (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '6px 8px' }}>Tier</th>
                  <th style={{ padding: '6px 8px' }}>What it means</th>
                </tr>
              </thead>
              <tbody>
                {policyData.tiers.map((t) => (
                  <tr key={t.tier} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                      <span className="tag">{t.label}</span>
                    </td>
                    <td style={{ padding: '8px', color: 'var(--text-2)' }}>{t.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="section-label" style={{ marginTop: 16 }}>
              Open signals behind each tier
            </div>
            <ul>
              {policyData.openSignals.map((s) => (
                <li key={s.name} style={{ marginBottom: 4, color: 'var(--text-2)' }}>
                  {s.name} → raises a source to <strong>{s.raises.replace('_', ' ')}</strong>.
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p style={{ color: 'var(--text-2)' }}>
            The tier definitions and open signals could not be loaded right now. The policy still applies to
            every report; this page will show the details again once the policy service is reachable.
          </p>
        )}

        <p className="meta-row" style={{ marginTop: 12 }}>
          <span>{versionNote}</span>
        </p>
      </Section>

      <Section label="Who reviews reports">
        <p>
          Automated integrity checks run on every report. When a check holds a report, it is marked for human
          review; the human review workflow itself is still being built, so a held report is shown to you
          transparently with its status rather than removed. Each review status means:
        </p>
        <ul>
          {REVIEW_STATUSES.map((r) => (
            <li key={r.name} style={{ marginBottom: 6 }}>
              <strong>{r.name}.</strong> {r.meaning}
            </li>
          ))}
        </ul>
      </Section>

      <Section label="How to dispute an analysis">
        <p>
          If you think a report or one of its claims is wrong, you can file a{' '}
          <Term
            term="Dispute"
            def="a user-submitted objection to a report or one of its claims"
          />
          . Open any report, use the <strong>“Dispute this analysis”</strong> control in the{' '}
          <Term
            term="Provenance Footer"
            def="the footer of a report showing model, versions, review status, and dispute count"
          />{' '}
          at the bottom of the report, and describe your objection in the{' '}
          <Term
            term="Dispute Modal"
            def="the form through which you submit a dispute"
          />
          . Disputes can be submitted without an account and are not tied to your identity. You can also{' '}
          <Term
            term="Flag"
            def="a community signal that a specific framing technique is present"
          />{' '}
          a framing technique when you are signed in. Submitting records your objection for later review.
        </p>
      </Section>

      <Section label="Our neutrality commitment">
        <p>
          <ShieldCheck size={15} style={{ verticalAlign: '-2px', color: 'var(--teal)' }} /> f-Socials describes{' '}
          <strong>framing and evidence</strong>. It does not present verdicts about content, does not assess
          whether content is ultimately true or false, and never attaches a reliability label to a creator.
          The goal is to help you inspect how a message is constructed so you can decide what to think — a
          lens, not a judge.
        </p>
      </Section>
    </div>
  );
}
