import { DEFAULT_LANGUAGE, isSupportedLanguage, type Language } from './catalog';
import { detectFromNavigator } from './detect';

const STORAGE_KEY = 'fsocials-language';

/**
 * Read + validate; a missing/invalid/unreadable value yields null (caller then detects).
 */
export function readStoredLanguage(): Language | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isSupportedLanguage(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Write, swallowing any storage rejection (private mode / quota) — never throws.
 */
export function writeStoredLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // ponytail: private-browsing or quota exceeded — session memory keeps the selection alive
  }
}

/**
 * Resolve the initial Active_Language: stored-if-valid → detect → default.
 */
export function resolveInitialLanguage(): Language {
  return readStoredLanguage() ?? detectFromNavigator() ?? DEFAULT_LANGUAGE;
}
