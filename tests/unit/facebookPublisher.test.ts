import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FACEBOOK_MAX_MESSAGE_CHARS } from '../../src/constants';
import { fetchPageName, publishToFacebook } from '../../src/publishers/facebook';

const realFetch = globalThis.fetch;

/** Records every call so the request itself can be asserted, not just the result. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response): {
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('publishToFacebook', () => {
  test('posts the message to the page feed and returns the post url', async () => {
    const stub = stubFetch(() => json({ id: '1234_5678' }));

    const result = await publishToFacebook({
      pageId: '1234',
      accessToken: 'tok',
      message: 'Hello world',
    });

    expect(result).toEqual({ id: '1234_5678', url: 'https://www.facebook.com/1234_5678' });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.url).toContain('/1234/feed');
    expect(stub.calls[0]?.init?.method).toBe('POST');
    const body = String(stub.calls[0]?.init?.body);
    expect(body).toContain('message=Hello+world');
    expect(body).toContain('access_token=tok');
  });

  test("surfaces Meta's own error message and code", async () => {
    stubFetch(() =>
      json(
        { error: { message: 'Error validating access token: Session has expired', code: 190 } },
        400,
      ),
    );

    await expect(
      publishToFacebook({ pageId: '1234', accessToken: 'stale', message: 'Hi' }),
    ).rejects.toThrow(/Session has expired.*190/);
  });

  test('falls back to the status when Meta returns no error body', async () => {
    stubFetch(() => new Response('nope', { status: 500 }));
    await expect(
      publishToFacebook({ pageId: '1234', accessToken: 'tok', message: 'Hi' }),
    ).rejects.toThrow(/500/);
  });

  test('rejects an over-length message without calling the network', async () => {
    const stub = stubFetch(() => json({ id: 'never' }));

    await expect(
      publishToFacebook({
        pageId: '1234',
        accessToken: 'tok',
        message: 'x'.repeat(FACEBOOK_MAX_MESSAGE_CHARS + 1),
      }),
    ).rejects.toThrow(/at most/);
    expect(stub.calls).toHaveLength(0);
  });

  test('rejects an empty message without calling the network', async () => {
    const stub = stubFetch(() => json({ id: 'never' }));
    await expect(
      publishToFacebook({ pageId: '1234', accessToken: 'tok', message: '   \n ' }),
    ).rejects.toThrow(/empty/);
    expect(stub.calls).toHaveLength(0);
  });

  test('throws when Meta accepts the post but returns no id', async () => {
    stubFetch(() => json({}));
    await expect(
      publishToFacebook({ pageId: '1234', accessToken: 'tok', message: 'Hi' }),
    ).rejects.toThrow(/no id/);
  });
});

describe('fetchPageName', () => {
  test('returns the page name', async () => {
    stubFetch(() => json({ name: 'EONYX' }));
    expect(await fetchPageName('1234', 'tok')).toBe('EONYX');
  });

  test('returns null rather than throwing when the lookup fails', async () => {
    stubFetch(() => json({ error: { message: 'bad token', code: 190 } }, 400));
    expect(await fetchPageName('1234', 'tok')).toBeNull();
  });
});
