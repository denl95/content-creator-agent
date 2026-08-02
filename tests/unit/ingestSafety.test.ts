import { describe, expect, test } from 'bun:test';
import { assertPublicUrl, isBlockedAddress } from '../../src/ingest/safety';

describe('isBlockedAddress', () => {
  test('blocks cloud metadata, the single most valuable SSRF target', () => {
    expect(isBlockedAddress('169.254.169.254')).toContain('metadata');
  });

  test('blocks loopback and the private ranges', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe('loopback');
    expect(isBlockedAddress('10.0.0.5')).toBe('private');
    expect(isBlockedAddress('172.16.0.1')).toBe('private');
    expect(isBlockedAddress('172.31.255.255')).toBe('private');
    expect(isBlockedAddress('192.168.1.1')).toBe('private');
    expect(isBlockedAddress('0.0.0.0')).toBe('this network');
  });

  test('allows public addresses either side of the private ranges', () => {
    expect(isBlockedAddress('8.8.8.8')).toBeNull();
    expect(isBlockedAddress('172.15.0.1')).toBeNull();
    expect(isBlockedAddress('172.32.0.1')).toBeNull();
    expect(isBlockedAddress('192.167.1.1')).toBeNull();
  });

  test('blocks IPv6 loopback and local ranges', () => {
    expect(isBlockedAddress('::1')).toContain('loopback');
    expect(isBlockedAddress('fd00::1')).toContain('unique-local');
    expect(isBlockedAddress('fe80::1')).toContain('link-local');
  });

  test('sees through an IPv4-mapped IPv6 address', () => {
    // ::ffff:127.0.0.1 is loopback wearing an IPv6 coat.
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe('loopback');
  });

  test('treats a hostname as unresolved rather than blocked', () => {
    expect(isBlockedAddress('example.com')).toBeNull();
  });
});

describe('assertPublicUrl', () => {
  test('rejects a literal private address', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /metadata/,
    );
    await expect(assertPublicUrl('http://127.0.0.1:3000/drafts')).rejects.toThrow(/loopback/);
  });

  test('rejects a hostname that resolves to loopback', async () => {
    // localhost is the plainest case of a public-looking name pointing inward.
    await expect(assertPublicUrl('http://localhost:8080/')).rejects.toThrow(/loopback/);
  });

  test('rejects non-http schemes', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/only http and https/);
  });

  test('allows an ordinary public URL', async () => {
    await expect(assertPublicUrl('https://example.com/about')).resolves.toBeUndefined();
  });
});
