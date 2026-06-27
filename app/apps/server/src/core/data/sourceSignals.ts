// Seed data for the source-tier policy (Requirement 2). Open signals ONLY:
//   - IFCN fact-checking signatory list      → contributes tier2_institutional
//   - institutional domain registry          → curated primary subset = tier1_primary,
//                                               everything else / suffix rules = tier2_institutional
//   - press-council membership list           → contributes tier2_institutional
//
// These signals are freely and commercially usable. This module deliberately seeds
// no third-party reliability/bias score dataset, and carries no content-creator
// dimension — the policy classifies sources and citations only, never creators.
//
// Data is stored as bare registrable domains, lowercased, without a leading `www.`.
// The classifier in `core/sourceTier.ts` (task 1.2) is responsible for parsing a
// source URL's host and matching it (host or registrable parent) against these sets.
//
// ponytail: these lists are curated, illustrative subsets, not exhaustive snapshots
// of the upstream registries. They are refreshed by editing this file; the upgrade
// path is a scheduled job that regenerates them from the upstream open lists.

// --- IFCN signatories (fact-checking organizations). Match → at least tier2. ---
export const IFCN_SIGNATORIES: ReadonlySet<string> = new Set([
  'politifact.com',
  'factcheck.org',
  'snopes.com',
  'fullfact.org',
  'africacheck.org',
  'afp.com',
  'leadstories.com',
  'checkyourfact.com',
  'factly.in',
  'boomlive.in',
  'maldita.es',
  'newtral.es',
  'correctiv.org',
  'pagellapolitica.it',
  'demagog.org.pl',
  'teyit.org',
  'factcheckni.org',
  'dpa.com',
  'verafiles.org',
  'rappler.com',
]);

// --- Institutional domain registry: curated PRIMARY-SOURCE subset. Match → tier1. ---
// Authoritative first-party publishers: official statistics, courts, primary records,
// and intergovernmental bodies that publish their own data.
export const PRIMARY_SOURCE_DOMAINS: ReadonlySet<string> = new Set([
  'supremecourt.gov',
  'congress.gov',
  'govinfo.gov',
  'federalregister.gov',
  'bls.gov',
  'census.gov',
  'cdc.gov',
  'nih.gov',
  'nist.gov',
  'nasa.gov',
  'noaa.gov',
  'who.int',
  'un.org',
  'imf.org',
  'worldbank.org',
  'oecd.org',
  'ec.europa.eu',
  'europa.eu',
]);

// --- Institutional domain registry: explicit institutional publishers. Match → tier2. ---
// Peer-reviewed venues and learned societies not captured by the suffix rules below.
export const INSTITUTIONAL_DOMAINS: ReadonlySet<string> = new Set([
  'nature.com',
  'science.org',
  'thelancet.com',
  'nejm.org',
  'bmj.com',
  'pnas.org',
  'cell.com',
  'arxiv.org',
  'ssrn.com',
  'jstor.org',
  'nationalacademies.org',
  'royalsociety.org',
  'ieee.org',
  'acm.org',
]);

// --- Institutional suffix rules: `.gov`, `.gov.*`, `.mil`, `.edu`, `.ac.*`, `.int`. ---
// A host whose suffix matches any of these is an institutional publisher → tier2.
// `.gov.*` / `.ac.*` cover country-scoped forms such as `gov.uk` and `ac.uk`.
// Each rule is anchored to the end of the (lowercased, dot-prefixed) host.
export const INSTITUTIONAL_SUFFIX_RULES: readonly RegExp[] = [
  /\.gov$/,
  /\.gov\.[a-z]{2,}$/,
  /\.mil$/,
  /\.edu$/,
  /\.ac\.[a-z]{2,}$/,
  /\.int$/,
];

// --- Press-council membership (regulated news publishers). Match → tier2. ---
export const PRESS_COUNCIL_MEMBERS: ReadonlySet<string> = new Set([
  'thetimes.co.uk',
  'telegraph.co.uk',
  'dailymail.co.uk',
  'independent.co.uk',
  'mirror.co.uk',
  'standard.co.uk',
  'thehindu.com',
  'indianexpress.com',
  'smh.com.au',
  'theage.com.au',
  'theglobeandmail.com',
  'thestar.com',
  'irishtimes.com',
]);
