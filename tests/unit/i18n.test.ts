import { describe, expect, test } from 'bun:test';
import { DEFAULT_LOCALE, getMessages, isLocale, LOCALES } from '../../web/i18n/index';
import en from '../../web/i18n/messages/en';
import uk from '../../web/i18n/messages/uk';

/** Every leaf path in a message object, so the two locales can be compared. */
function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function read(source: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], source);
}

describe('locales', () => {
  test('isLocale accepts the supported tags and nothing else', () => {
    expect(isLocale('uk')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale('UK')).toBe(false); // the URL segment is lowercase
  });

  test('Ukrainian is the default, and both locales are listed', () => {
    expect(DEFAULT_LOCALE).toBe('uk');
    expect([...LOCALES].sort()).toEqual(['en', 'uk']);
  });

  test('getMessages returns the matching catalogue', () => {
    expect(getMessages('en').nav.brands).toBe(en.nav.brands);
    expect(getMessages('uk').nav.brands).toBe(uk.nav.brands);
  });
});

describe('catalogue shape', () => {
  test('the two locales have exactly the same keys', () => {
    // `Messages` catches this at build time; asserting it here too means a
    // failure names the offending key instead of a forty-line type error.
    expect(paths(uk).sort()).toEqual(paths(en).sort());
  });

  test('no Ukrainian string was left as its English source', () => {
    const shared = paths(en).filter((path) => {
      const source = read(en, path);
      return typeof source === 'string' && source === read(uk, path);
    });
    // Only genuinely locale-neutral strings may match — the brand name.
    expect(shared).toEqual(['app.name']);
  });

  test('interpolating messages exist in both locales as functions', () => {
    // A function replaced by a plain string would drop its arguments silently.
    for (const path of paths(en)) {
      if (typeof read(en, path) === 'function') {
        expect(typeof read(uk, path)).toBe('function');
      }
    }
  });
});
