import { DEFAULT_LANGUAGE, type Language, type MessageCatalog } from './catalog';

/**
 * Resolve a String_Key for a language with the fallback chain:
 *   active catalog → default (en) catalog → visible placeholder derived from key.
 * Always returns a non-empty string. Whitespace-only catalog values count as absent.
 */
export function resolve(
  key: string,
  language: Language,
  catalogs: Record<Language, MessageCatalog>,
): string {
  const active = catalogs[language]?.[key];
  if (typeof active === 'string' && active.trim().length > 0) return active;

  const fallback = catalogs[DEFAULT_LANGUAGE]?.[key];
  if (typeof fallback === 'string' && fallback.trim().length > 0) return fallback;

  // Derive a non-empty visible placeholder from the key's last dotted segment.
  const lastSegment = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
  // ponytail: if the key itself is empty or whitespace, return a fixed placeholder
  return lastSegment.trim().length > 0 ? lastSegment : 'untranslated';
}

/**
 * Substitute named {placeholder} tokens with supplied values. An unmatched token is
 * left visible (never blanked); a placeholder with no supplied value stays as written.
 */
export function fill(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{([^}]+)\}/g, (token, name: string) => {
    const val = values[name];
    return val != null ? String(val) : token;
  });
}

/**
 * Convenience: resolve then fill. Guarantees a non-empty string on every path (never throws).
 */
export function translate(
  key: string,
  language: Language,
  catalogs: Record<Language, MessageCatalog>,
  values?: Record<string, string | number>,
): string {
  return fill(resolve(key, language, catalogs), values);
}
