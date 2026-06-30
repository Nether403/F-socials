import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatDate, formatNumber } from './format';

// Feature: en-nl-localization, Edge-case: Intl unavailability
// Validates: Requirements 6.7

describe('format – Intl unavailable', () => {
  const originalIntl = globalThis.Intl;

  beforeEach(() => {
    vi.stubGlobal('Intl', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('formatDate returns the string representation when Intl is unavailable', () => {
    const date = new Date('2024-01-15');
    const result = formatDate(date, 'en');
    expect(result).toBe(String(date));
  });

  it('formatNumber returns the string representation when Intl is unavailable', () => {
    const result = formatNumber(1234.56, 'nl');
    expect(result).toBe('1234.56');
  });

  it('formatDate does not throw when Intl is unavailable', () => {
    expect(() => formatDate(new Date(), 'nl')).not.toThrow();
  });

  it('formatNumber does not throw when Intl is unavailable', () => {
    expect(() => formatNumber(42, 'en')).not.toThrow();
  });
});
