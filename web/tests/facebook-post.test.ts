import { afterEach, describe, expect, test } from 'bun:test';
import en from '../i18n/messages/en';
import { postDraftToFacebook } from '../lib/facebook';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('postDraftToFacebook', () => {
  test('returns the post url on success', async () => {
    globalThis.fetch = (async () =>
      json({ url: 'https://www.facebook.com/1234_5678' }, 200)) as typeof fetch;

    const result = await postDraftToFacebook('d1', en);
    expect(result).toEqual({ url: 'https://www.facebook.com/1234_5678' });
  });

  test('translates a 502 facebook_publish_failed response', async () => {
    globalThis.fetch = (async () =>
      json({ error: 'facebook_publish_failed', message: 'Session has expired' }, 502)) as typeof fetch;

    const result = await postDraftToFacebook('d1', en);
    expect(result).toEqual({ error: en.errors.facebookPublishFailed });
  });

  test('translates a 409 facebook_already_published response', async () => {
    globalThis.fetch = (async () =>
      json({ error: 'facebook_already_published', message: 'already posted' }, 409)) as typeof fetch;

    const result = await postDraftToFacebook('d1', en);
    expect(result).toEqual({ error: en.errors.facebookAlreadyPublished });
  });

  test('returns the fallback message rather than throwing when fetch rejects', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const result = await postDraftToFacebook('d1', en);
    expect(result).toEqual({ error: en.errors.facebookPublishFailed });
  });
});
