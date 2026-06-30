import type { Language } from './catalog';

const LOCALE: Record<Language, string> = { en: 'en-US', nl: 'nl-NL' };

/**
 * Format a date for the given language via Intl.DateTimeFormat.
 * Guards: missing Intl → return unformatted; invalid date → return original string.
 * Never throws.
 */
export function formatDate(
  value: Date | string | number,
  language: Language,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (typeof Intl === 'undefined') return String(value);

  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else {
    date = new Date(value);
  }

  if (isNaN(date.getTime())) return String(value);

  try {
    return new Intl.DateTimeFormat(LOCALE[language], opts).format(date);
  } catch {
    return String(value);
  }
}

/**
 * Format a number for the given language via Intl.NumberFormat.
 * Guards: missing Intl → return unformatted; NaN/Infinity → return original string.
 * Never throws.
 */
export function formatNumber(
  value: number,
  language: Language,
  opts?: Intl.NumberFormatOptions,
): string {
  if (typeof Intl === 'undefined') return String(value);
  if (!isFinite(value)) return String(value);

  try {
    return new Intl.NumberFormat(LOCALE[language], opts).format(value);
  } catch {
    return String(value);
  }
}
