import { DEFAULT_LANGUAGE, isSupportedLanguage, type Language } from './catalog';

/**
 * Walk browser-reported preferences highest→lowest priority; return the first whose
 * primary subtag (case-insensitive) is a Supported_Language; else DEFAULT_LANGUAGE.
 */
export function detectLanguage(preferences: readonly string[]): Language {
  for (const tag of preferences) {
    const primary = tag.split('-')[0].toLowerCase();
    if (isSupportedLanguage(primary)) return primary;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Read navigator.languages (falling back to [navigator.language]) for the live call.
 */
export function detectFromNavigator(): Language {
  const prefs =
    typeof navigator !== 'undefined' && navigator.languages?.length
      ? navigator.languages
      : typeof navigator !== 'undefined' && navigator.language
        ? [navigator.language]
        : [];
  return detectLanguage(prefs);
}
