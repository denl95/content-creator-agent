import { afterEach, describe, expect, test } from 'bun:test';
import { isAuthEnabled, sessionToken, verifyPassword, verifySessionCookie } from '../../src/auth';

const original = process.env.DEMO_PASSWORD;
afterEach(() => {
  if (original === undefined) delete process.env.DEMO_PASSWORD;
  else process.env.DEMO_PASSWORD = original;
});

describe('auth disabled (DEMO_PASSWORD unset)', () => {
  test('isAuthEnabled is false and every cookie passes', () => {
    delete process.env.DEMO_PASSWORD;
    expect(isAuthEnabled()).toBe(false);
    expect(verifySessionCookie(undefined)).toBe(true);
    expect(verifySessionCookie('anything')).toBe(true);
  });

  test('an empty string counts as unset', () => {
    process.env.DEMO_PASSWORD = '';
    expect(isAuthEnabled()).toBe(false);
  });
});

describe('auth enabled', () => {
  test('accepts the correct password and rejects others', () => {
    process.env.DEMO_PASSWORD = 'hunter2';
    expect(isAuthEnabled()).toBe(true);
    expect(verifyPassword('hunter2')).toBe(true);
    expect(verifyPassword('wrong')).toBe(false);
    expect(verifyPassword('')).toBe(false);
  });

  test('a token from the right password validates; a forged one does not', () => {
    process.env.DEMO_PASSWORD = 'hunter2';
    const token = sessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySessionCookie(token)).toBe(true);
    expect(verifySessionCookie('deadbeef')).toBe(false);
    expect(verifySessionCookie(undefined)).toBe(false);
  });

  test('the token is not the password itself', () => {
    process.env.DEMO_PASSWORD = 'hunter2';
    expect(sessionToken()).not.toContain('hunter2');
  });

  test('changing the password invalidates old tokens', () => {
    process.env.DEMO_PASSWORD = 'first';
    const old = sessionToken();
    process.env.DEMO_PASSWORD = 'second';
    expect(verifySessionCookie(old)).toBe(false);
  });
});
