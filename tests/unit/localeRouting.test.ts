import { describe, expect, test } from 'bun:test';
import { resolveLocale } from '../../web/i18n/index';

describe('resolveLocale', () => {
  test('a valid cookie wins outright', () => {
    expect(resolveLocale('en', 'uk-UA,uk;q=0.9')).toBe('en');
    expect(resolveLocale('uk', 'en-GB,en;q=0.9')).toBe('uk');
  });

  test('an unsupported cookie is ignored rather than trusted', () => {
    expect(resolveLocale('de', 'en-GB,en;q=0.9')).toBe('en');
  });

  test('falls back to Accept-Language when there is no cookie', () => {
    expect(resolveLocale(undefined, 'en-GB,en;q=0.9')).toBe('en');
    expect(resolveLocale(undefined, 'uk-UA,uk;q=0.9,en;q=0.8')).toBe('uk');
  });

  test('takes the first supported tag, not merely the first tag', () => {
    expect(resolveLocale(undefined, 'de-DE,de;q=0.9,en;q=0.8')).toBe('en');
  });

  test('defaults to Ukrainian when nothing matches', () => {
    expect(resolveLocale(undefined, 'de-DE,fr;q=0.8')).toBe('uk');
    expect(resolveLocale(undefined, '')).toBe('uk');
    expect(resolveLocale(undefined, null)).toBe('uk');
  });
});
