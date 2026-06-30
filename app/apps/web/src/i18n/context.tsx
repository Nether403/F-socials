import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { Language, MessageCatalog } from './catalog';
import { en } from './en';
import { nl } from './nl';
import { translate } from './resolve';
import { formatDate as fmtDate, formatNumber as fmtNumber } from './format';
import { writeStoredLanguage, resolveInitialLanguage } from './persist';

interface LanguageContextValue {
  language: Language;
  setLanguage: (next: Language) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  formatDate: (v: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (v: number, opts?: Intl.NumberFormatOptions) => string;
}

const catalogs: Record<Language, MessageCatalog> = { en, nl };

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Extract the primary subtag (first segment before '-') from a language code.
 * Returns null if no non-empty subtag can be resolved.
 */
function primarySubtag(lang: Language): string | null {
  const sub = lang.split('-')[0]?.trim();
  return sub && sub.length > 0 ? sub : null;
}

/**
 * Set document.documentElement.lang to the primary subtag of the given language.
 * Leaves the previous value untouched when no subtag resolves.
 */
function setDocumentLang(lang: Language): void {
  const sub = primarySubtag(lang);
  if (sub) {
    document.documentElement.lang = sub;
  }
  // ponytail: if no subtag resolves, leave previous lang untouched (Req 8.5)
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(resolveInitialLanguage);

  // Set <html lang> on initial mount
  useEffect(() => {
    setDocumentLang(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLanguage = useCallback(
    (next: Language) => {
      if (next === language) return; // ponytail: idempotent no-op (Req 1.5)
      setLanguageState(next);
      writeStoredLanguage(next);
      setDocumentLang(next);
    },
    [language],
  );

  const t = useCallback(
    (key: string, values?: Record<string, string | number>) => translate(key, language, catalogs, values),
    [language],
  );

  const formatDate = useCallback(
    (v: Date | string | number, opts?: Intl.DateTimeFormatOptions) => fmtDate(v, language, opts),
    [language],
  );

  const formatNumber = useCallback(
    (v: number, opts?: Intl.NumberFormatOptions) => fmtNumber(v, language, opts),
    [language],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, formatDate, formatNumber }}>
      {children}
    </LanguageContext.Provider>
  );
}

/** Returns { language, setLanguage, t } — the translation hook. */
export function useT() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useT must be used within a LanguageProvider');
  return { language: ctx.language, setLanguage: ctx.setLanguage, t: ctx.t };
}

/** Returns { language, setLanguage } — for components that only need the locale. */
export function useLocale() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLocale must be used within a LanguageProvider');
  return { language: ctx.language, setLanguage: ctx.setLanguage };
}

/** Returns { formatDate, formatNumber } — the formatting hook. */
export function useFmt() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useFmt must be used within a LanguageProvider');
  return { formatDate: ctx.formatDate, formatNumber: ctx.formatNumber };
}
