// Source-tier policy (Requirement 2): a PURE, offline classifier that derives a
// SourceTier for one citation from open signals only (IFCN signatories, the
// institutional domain registry + suffix rules, and press-council membership).
//
// The function takes a source URL and nothing else — there is structurally no
// content-creator parameter, which guarantees the policy can never produce a
// creator rating (2.7, 2.9). It performs no network I/O, so it is deterministic,
// fast, and fully property-testable.
//
// ponytail: "registrable parent" matching is approximated by walking the host's
// dot-suffixes (host, then each parent down to the eTLD+1 region) and matching
// each against the seeded sets — no public-suffix-list dependency. Seed lists are
// curated subsets; the upgrade path (in core/data/sourceSignals.ts) is a scheduled
// regen job, and a PSL lookup if multi-label-eTLD precision is ever required.

import type { SourceTier } from '../types';
import {
  IFCN_SIGNATORIES,
  PRIMARY_SOURCE_DOMAINS,
  INSTITUTIONAL_DOMAINS,
  INSTITUTIONAL_SUFFIX_RULES,
  PRESS_COUNCIL_MEMBERS,
} from './data/sourceSignals';

export const SOURCE_POLICY_VERSION = 'v1';

// Ordered set, highest first. Rank drives "highest matching signal wins" (2.10).
export const TIER_RANK: Record<SourceTier, number> = {
  tier1_primary: 3,
  tier2_institutional: 2,
  tier3_viewpoint: 1,
  excluded: 0,
};

export interface PolicyDescriptor {
  version: string;
  tiers: { tier: SourceTier; label: string; meaning: string }[];
  openSignals: { name: string; raises: SourceTier }[];
}

// Parse a publishing host from a (possibly scheme-less) source URL. Returns the
// lowercased, www-stripped host, or null when no valid publishing host resolves.
function parseHost(sourceUrl: string): string | null {
  if (typeof sourceUrl !== 'string') return null;
  const trimmed = sourceUrl.trim();
  if (!trimmed) return null;
  // Prepend a scheme when absent so the URL parser can locate the authority.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, ''); // drop a trailing root dot
  if (host.startsWith('www.')) host = host.slice(4);
  // A valid publishing domain has >=2 dot-separated labels and an alphabetic TLD.
  // This rejects bare hosts ("localhost"), IP addresses, and empty authorities.
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) return null;
  return host;
}

// host + each registrable-parent suffix, e.g.
//   news.bbc.co.uk -> [news.bbc.co.uk, bbc.co.uk, co.uk]
// (stops before the bare TLD, which can never match a seeded signal).
function domainCandidates(host: string): string[] {
  const labels = host.split('.');
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) {
    out.push(labels.slice(i).join('.'));
  }
  return out;
}

// Classify ONE citation's source URL into exactly one tier, from open signals only.
export function classifyCitationTier(sourceUrl: string): SourceTier {
  const host = parseHost(sourceUrl);
  if (host === null) return 'excluded'; // unresolvable publishing host (2.11)

  const candidates = domainCandidates(host);
  const onSet = (set: ReadonlySet<string>): boolean => candidates.some((c) => set.has(c));

  // Collect the tier contributed by every matching open signal.
  const matched: SourceTier[] = [];
  if (onSet(IFCN_SIGNATORIES)) matched.push('tier2_institutional'); // at least tier2 (2.3)
  if (onSet(PRIMARY_SOURCE_DOMAINS)) matched.push('tier1_primary'); // curated primary subset (2.4)
  if (onSet(INSTITUTIONAL_DOMAINS)) matched.push('tier2_institutional'); // institutional registry (2.4)
  const dotted = `.${host}`;
  if (INSTITUTIONAL_SUFFIX_RULES.some((re) => re.test(dotted))) {
    matched.push('tier2_institutional'); // .gov/.gov.*/.mil/.edu/.ac.*/.int (2.4)
  }
  if (onSet(PRESS_COUNCIL_MEMBERS)) matched.push('tier2_institutional'); // press council (2.4)

  if (matched.length === 0) return 'tier3_viewpoint'; // no signal matched (2.8)

  // Highest-ranked matching signal wins (2.10).
  return matched.reduce((best, t) => (TIER_RANK[t] > TIER_RANK[best] ? t : best));
}

// Exposed for the GET /api/v1/policy endpoint and the methodology page (2.5).
export function policyDescriptor(): PolicyDescriptor {
  return {
    version: SOURCE_POLICY_VERSION,
    tiers: [
      {
        tier: 'tier1_primary',
        label: 'Primary source',
        meaning:
          'First-party authoritative record: official statistics, court filings, primary documents, or an intergovernmental body publishing its own data.',
      },
      {
        tier: 'tier2_institutional',
        label: 'Institutional source',
        meaning:
          'A fact-checking signatory, an academic/governmental/institutional publisher, or a press-council-regulated outlet.',
      },
      {
        tier: 'tier3_viewpoint',
        label: 'Viewpoint source',
        meaning: 'A publishing host that matches no open institutional signal; read it as a viewpoint, not a verified record.',
      },
      {
        tier: 'excluded',
        label: 'Excluded',
        meaning: 'No valid publishing host could be resolved from the source URL.',
      },
    ],
    openSignals: [
      { name: 'IFCN fact-checking signatories', raises: 'tier2_institutional' },
      { name: 'Primary-source domain registry (official statistics, courts, intergovernmental bodies)', raises: 'tier1_primary' },
      {
        name: 'Institutional domain registry (.gov, .gov.*, .mil, .edu, .ac.*, .int, and peer-reviewed venues)',
        raises: 'tier2_institutional',
      },
      { name: 'Press-council membership', raises: 'tier2_institutional' },
    ],
  };
}
