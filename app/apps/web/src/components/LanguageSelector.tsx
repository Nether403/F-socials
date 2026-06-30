import { Languages } from 'lucide-react';
import { useT } from '../i18n/context';

/**
 * Language_Selector: two native <button>s in a role="group" offering English / Dutch.
 * Keyboard reachable (Tab) and activatable (Enter/Space) by construction (native buttons).
 * The Languages icon from lucide-react sits beside visible text labels (color-never-alone).
 * Inherits the existing ≤768px single-column layout via topbar-actions placement.
 *
 * Requirements: 1.1, 1.4, 8.1, 8.2, 8.3, 8.6, 8.7, 8.8, 8.9
 */
export function LanguageSelector() {
  const { language, setLanguage, t } = useT();

  return (
    <div className="lang-selector" role="group" aria-label={t('lang.label')}>
      <Languages size={15} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 5 }} />
      <button
        type="button"
        className={`tab ${language === 'en' ? 'active' : ''}`}
        aria-pressed={language === 'en'}
        onClick={() => setLanguage('en')}
      >
        {t('lang.en')}
      </button>
      <button
        type="button"
        className={`tab ${language === 'nl' ? 'active' : ''}`}
        aria-pressed={language === 'nl'}
        onClick={() => setLanguage('nl')}
      >
        {t('lang.nl')}
      </button>
    </div>
  );
}
