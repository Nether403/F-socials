// Test helper: wraps a rendered component in LanguageProvider so useT resolves.
// ponytail: single source of truth for i18n test wrapping across all report component tests.
import { render, type RenderResult } from '@testing-library/react';
import { LanguageProvider } from '../i18n/context';

export function renderWithLang(ui: React.ReactElement): RenderResult {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}
