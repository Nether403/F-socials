import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeFeedUrl, resolveIntensity, intensityStore } from './frictionModule';
import type { Intensity } from './frictionModule';

describe('normalizeFeedUrl', () => {
  it('strips tracking params (utm_source, fbclid, etc.)', () => {
    const raw = 'https://example.com/article?utm_source=twitter&fbclid=abc&id=42';
    expect(normalizeFeedUrl(raw)).toBe('https://example.com/article?id=42');
  });

  it('lowercases hostname and removes www.', () => {
    expect(normalizeFeedUrl('https://WWW.Example.COM/path')).toBe('https://example.com/path');
  });

  it('removes hash fragment', () => {
    expect(normalizeFeedUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('sorts remaining query params', () => {
    const raw = 'https://example.com/?z=1&a=2';
    expect(normalizeFeedUrl(raw)).toBe('https://example.com/?a=2&z=1');
  });

  it('trims whitespace', () => {
    expect(normalizeFeedUrl('  https://example.com/  ')).toBe('https://example.com/');
  });

  it('returns trimmed input for invalid URLs', () => {
    expect(normalizeFeedUrl('  not a url  ')).toBe('not a url');
  });

  it('matches server normalization for a YouTube URL with tracking', () => {
    const raw = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123&utm_campaign=foo';
    expect(normalizeFeedUrl(raw)).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ');
  });
});

describe('resolveIntensity', () => {
  it('returns "moderate" for null', () => {
    expect(resolveIntensity(null)).toBe('moderate');
  });

  it('returns "moderate" for unknown string', () => {
    expect(resolveIntensity('banana')).toBe('moderate');
  });

  it('returns "moderate" for empty string', () => {
    expect(resolveIntensity('')).toBe('moderate');
  });

  it.each(['subtle', 'moderate', 'interruptive'] as Intensity[])('returns "%s" for valid value', (v) => {
    expect(resolveIntensity(v)).toBe(v);
  });
});

describe('intensityStore', () => {
  it('defaults to moderate without chrome.storage', async () => {
    expect(await intensityStore.get()).toBe('moderate');
  });

  it('set then get round-trips (in-memory fallback)', async () => {
    await intensityStore.set('interruptive');
    expect(await intensityStore.get()).toBe('interruptive');
    // Reset for other tests
    await intensityStore.set('moderate');
  });

  it('subscribe is notified on set', async () => {
    const cb = vi.fn();
    const unsub = intensityStore.subscribe(cb);
    await intensityStore.set('subtle');
    expect(cb).toHaveBeenCalledWith('subtle');
    unsub();
    await intensityStore.set('moderate');
  });

  it('unsubscribe stops notifications', async () => {
    const cb = vi.fn();
    const unsub = intensityStore.subscribe(cb);
    unsub();
    await intensityStore.set('interruptive');
    expect(cb).not.toHaveBeenCalled();
    await intensityStore.set('moderate');
  });

  describe('with chrome.storage.local mock', () => {
    let storage: Record<string, any>;

    beforeEach(() => {
      storage = {};
      (globalThis as any).chrome = {
        storage: {
          local: {
            get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
            set: vi.fn(async (obj: Record<string, any>) => { Object.assign(storage, obj); }),
          },
        },
      };
    });

    it('persists to chrome.storage.local', async () => {
      await intensityStore.set('interruptive');
      expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalledWith({
        f_socials_intensity: 'interruptive',
      });
    });

    it('reads from chrome.storage.local', async () => {
      storage['f_socials_intensity'] = 'subtle';
      expect(await intensityStore.get()).toBe('subtle');
    });

    it('handles storage read failure gracefully', async () => {
      (globalThis as any).chrome.storage.local.get = vi.fn(async () => { throw new Error('quota'); });
      expect(await intensityStore.get()).toBe('moderate');
    });

    it('handles storage write failure gracefully', async () => {
      (globalThis as any).chrome.storage.local.set = vi.fn(async () => { throw new Error('full'); });
      // Should not throw
      await expect(intensityStore.set('subtle')).resolves.toBeUndefined();
    });

    // Cleanup
    afterEach(() => {
      delete (globalThis as any).chrome;
      // Reset in-memory state
      intensityStore.set('moderate');
    });
  });
});
