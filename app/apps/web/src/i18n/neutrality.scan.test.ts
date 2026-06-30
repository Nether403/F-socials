// Feature: en-nl-localization — Neutrality denylist scan
// A static check iterating every value of both catalogs against a curated denylist
// of truthfulness-verdict and creator-rating phrasings. Fails the suite and names
// the offending String_Key when a value matches.
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.6

import { describe, it, expect } from 'vitest';
import { en } from './en';
import { nl } from './nl';

// Curated denylist of truthfulness-verdict and creator/channel-rating phrasings.
// Each regex is tested case-insensitively against every catalog value.
const DENYLIST: { pattern: RegExp; label: string }[] = [
  // -- Truthfulness verdicts (English) ----------------------------------------
  { pattern: /\bis true\b/, label: 'is true' },
  { pattern: /\bis false\b/, label: 'is false' },
  { pattern: /\bis fake\b/, label: 'is fake' },
  { pattern: /\bis real\b/, label: 'is real' },
  { pattern: /\bis accurate\b/, label: 'is accurate' },
  { pattern: /\bis inaccurate\b/, label: 'is inaccurate' },
  { pattern: /\bconfirmed true\b/, label: 'confirmed true' },
  { pattern: /\bconfirmed false\b/, label: 'confirmed false' },
  { pattern: /\bdebunked\b/, label: 'debunked' },
  { pattern: /\bverified fact\b/, label: 'verified fact' },
  { pattern: /\bverified as\b/, label: 'verified as' },
  { pattern: /\bproven true\b/, label: 'proven true' },
  { pattern: /\bproven false\b/, label: 'proven false' },

  // -- Creator/channel ratings (English) --------------------------------------
  { pattern: /\breliable source\b/, label: 'reliable source' },
  { pattern: /\bunreliable source\b/, label: 'unreliable source' },
  { pattern: /\btrustworthy\b/, label: 'trustworthy' },
  { pattern: /\buntrustworthy\b/, label: 'untrustworthy' },
  { pattern: /\bcredible source\b/, label: 'credible source' },
  { pattern: /\bnot credible\b/, label: 'not credible' },
  { pattern: /\breliable creator\b/, label: 'reliable creator' },
  { pattern: /\bunreliable creator\b/, label: 'unreliable creator' },
  { pattern: /\btrusted channel\b/, label: 'trusted channel' },
  { pattern: /\buntrusted\b/, label: 'untrusted' },

  // -- Truthfulness verdicts (Dutch) ------------------------------------------
  { pattern: /\bis waar\b/, label: 'is waar' },
  { pattern: /\bis onwaar\b/, label: 'is onwaar' },
  { pattern: /\bis nep\b/, label: 'is nep' },
  { pattern: /\bis echt\b/, label: 'is echt' },
  { pattern: /\bbewezen waar\b/, label: 'bewezen waar' },
  { pattern: /\bbewezen onwaar\b/, label: 'bewezen onwaar' },
  { pattern: /\bontkracht\b/, label: 'ontkracht' },
  { pattern: /\bgeverifieerd feit\b/, label: 'geverifieerd feit' },

  // -- Creator/channel ratings (Dutch) ----------------------------------------
  { pattern: /\bbetrouwbare bron\b/, label: 'betrouwbare bron' },
  { pattern: /\bonbetrouwbare bron\b/, label: 'onbetrouwbare bron' },
  { pattern: /\bonbetrouwbaar\b/, label: 'onbetrouwbaar' },
  { pattern: /\bbetrouwbare maker\b/, label: 'betrouwbare maker' },
  { pattern: /\bonbetrouwbare maker\b/, label: 'onbetrouwbare maker' },
  { pattern: /\bbetrouwbaar kanaal\b/, label: 'betrouwbaar kanaal' },
  { pattern: /\bonbetrouwbaar kanaal\b/, label: 'onbetrouwbaar kanaal' },
];

function scanCatalog(catalog: Record<string, string>, language: string) {
  const violations: string[] = [];
  for (const [key, value] of Object.entries(catalog)) {
    for (const { pattern, label } of DENYLIST) {
      if (pattern.test(value.toLowerCase())) {
        violations.push(`[${language}] "${key}" matched denylist pattern "${label}"`);
      }
    }
  }
  return violations;
}

describe('Neutrality denylist scan', () => {
  it('English catalog contains no truthfulness-verdict or creator-rating phrasing', () => {
    const violations = scanCatalog(en as unknown as Record<string, string>, 'en');
    expect(violations, violations.join('\n')).toHaveLength(0);
  });

  it('Dutch catalog contains no truthfulness-verdict or creator-rating phrasing', () => {
    const violations = scanCatalog(nl as unknown as Record<string, string>, 'nl');
    expect(violations, violations.join('\n')).toHaveLength(0);
  });
});
