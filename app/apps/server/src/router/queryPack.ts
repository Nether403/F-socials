// Stage 3 of the Claim_Verification_Router: Query_Pack generation (Requirement 2).
// PURE and deterministic given a Canonical_Claim and an optional language hint —
// no I/O, no LLM. The router's normalizer produces the Canonical_Claim upstream;
// this module only expands it into a small set of purpose-distinct Query_Variants
// to drive recall, each tagged with its QueryVariantKind so retrieval/audit can
// tell the variants apart.
//
// The four required kinds are always present (2.1); a non-English language hint
// adds exactly one source_language and one english variant (2.3); the pack is
// capped at six variants total (2.2); the exact_normalized variant is the
// Canonical_Claim verbatim (2.5).

import type { QueryVariant } from '../types';

const MAX_VARIANTS = 6;

// Small stopword set for the compressed entity-predicate variant. ponytail: a
// curated list, not a linguistic stemmer — it strips the high-frequency function
// words that cause keyword drift while leaving entities and the predicate intact.
// Ceiling: English-only and shallow; upgrade path is a real keyphrase extractor
// if the offline benchmark shows the compressed variant under-recalling.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'and', 'or', 'but',
  'that', 'this', 'these', 'those', 'it', 'its', 'as', 'from', 'has', 'have',
  'had', 'will', 'would', 'should', 'could', 'than', 'then', 'so', 'into',
]);

function compressEntityPredicate(claim: string): string {
  const compressed = claim
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // drop punctuation
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .join(' ')
    .trim();
  // Never emit an empty query: fall back to the original claim if the claim was
  // entirely stopwords/punctuation.
  return compressed.length > 0 ? compressed : claim.trim();
}

function negate(claim: string): string {
  const trimmed = claim.trim();
  // Flip the first auxiliary/copula we recognise; otherwise wrap the whole claim.
  const flips: [RegExp, string][] = [
    [/\bis not\b/i, 'is'],
    [/\bare not\b/i, 'are'],
    [/\bwas not\b/i, 'was'],
    [/\bwere not\b/i, 'were'],
    [/\bis\b/i, 'is not'],
    [/\bare\b/i, 'are not'],
    [/\bwas\b/i, 'was not'],
    [/\bwere\b/i, 'were not'],
    [/\bdid\b/i, 'did not'],
    [/\bdoes\b/i, 'does not'],
    [/\bhas\b/i, 'has not'],
    [/\bhave\b/i, 'have not'],
    [/\bwill\b/i, 'will not'],
  ];
  for (const [pattern, replacement] of flips) {
    if (pattern.test(trimmed)) {
      return trimmed.replace(pattern, replacement);
    }
  }
  return `It is not true that ${trimmed}`;
}

// A language hint counts as non-English when it is present and not an English
// locale ('en', 'en-US', 'EN', …). Empty/undefined means "treat as English".
function isNonEnglish(langHint?: string): boolean {
  if (!langHint) return false;
  return !/^en(-|$)/i.test(langHint.trim());
}

/**
 * Generate a Query_Pack from a Canonical_Claim.
 *
 * @param canonicalClaim the normalized, checkable claim text (Canonical_Claim).
 * @param langHint optional BCP-47-ish language hint for the claim's topic; when
 *   it denotes a non-English language, a source_language and an english variant
 *   are added.
 * @returns 4–6 purpose-distinct Query_Variants, each tagged with its kind.
 */
function generate(canonicalClaim: string, langHint?: string): QueryVariant[] {
  const claim = canonicalClaim.trim();

  const variants: QueryVariant[] = [
    // 2.5: exact_normalized is derived directly from the Canonical_Claim.
    { text: claim, kind: 'exact_normalized' },
    { text: compressEntityPredicate(claim), kind: 'compressed_entity_predicate' },
    { text: `fact check: ${claim}`, kind: 'fact_check_style' },
    { text: negate(claim), kind: 'counterclaim_negated' },
  ];

  if (isNonEnglish(langHint)) {
    // 2.3: a non-English topic gets one source-language and one English variant.
    // ponytail: actual translation is an LLM/provider concern (deferred to the
    // normalizer in prod); offline these carry the canonical text tagged by kind
    // so retrieval still issues them as distinct, labelled queries. Ceiling: no
    // real translation here; upgrade path is to populate text from the
    // normalizer's translated forms when the LLM normalizer is wired.
    variants.push({ text: claim, kind: 'source_language' });
    variants.push({ text: claim, kind: 'english' });
  }

  // 2.2: never exceed six variants. The required four always survive the cap
  // because they are emitted first.
  return variants.slice(0, MAX_VARIANTS);
}

export const QueryPackGenerator = { generate };
