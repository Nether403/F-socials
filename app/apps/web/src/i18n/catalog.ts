export type Language = 'en' | 'nl';
export const SUPPORTED_LANGUAGES = ['en', 'nl'] as const;
export const DEFAULT_LANGUAGE: Language = 'en';

// A catalog is a flat map from String_Key to a message template.
export type MessageCatalog = Record<string, string>;

export function isSupportedLanguage(v: unknown): v is Language {
  return v === 'en' || v === 'nl';
}
