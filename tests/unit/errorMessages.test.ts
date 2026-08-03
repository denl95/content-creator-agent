import { describe, expect, test } from 'bun:test';
import en from '../../web/i18n/messages/en';
import uk from '../../web/i18n/messages/uk';
import { messageForCode } from '../../web/lib/errors';

describe('messageForCode', () => {
  test('maps a known code to the active locale', () => {
    expect(messageForCode('brand_not_found', uk)).toBe(uk.errors.brandNotFound);
    expect(messageForCode('brand_not_found', en)).toBe(en.errors.brandNotFound);
  });

  test('an unknown code falls through so the caller can use the server prose', () => {
    expect(messageForCode('some_future_code', uk)).toBeNull();
  });

  test('every code the server can return is mapped', () => {
    // Adding a code to the API without a translation is the failure this
    // catches — it would otherwise surface as English in a Ukrainian view.
    for (const code of [
      'unauthorized',
      'password_required',
      'invalid_password',
      'brand_not_found',
      'brand_inactive',
      'brand_has_no_sources',
      'brand_paste_only',
      'brand_is_default',
      'draft_not_found',
      'run_not_found',
      'run_not_awaiting',
      'notion_not_configured',
      'publish_failed',
    ]) {
      expect(messageForCode(code, uk)).not.toBeNull();
      expect(messageForCode(code, en)).not.toBeNull();
    }
  });
});
