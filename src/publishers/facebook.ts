import { FACEBOOK_API_VERSION, FACEBOOK_MAX_MESSAGE_CHARS } from '../constants';

export type FacebookPostArgs = { pageId: string; accessToken: string; message: string };
export type FacebookPostResult = { id: string; url: string };

type GraphErrorBody = {
  error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
};

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${FACEBOOK_API_VERSION}/${path}`;
}

/**
 * Meta's prose, verbatim, plus its numeric code.
 *
 * This app cannot tell a stale token from a wrong Page id from a missing
 * permission — the three have identical symptoms from here and only Meta names
 * which one it is. A generic "publish failed" would make the most likely
 * real-world failure undiagnosable.
 */
async function graphErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as GraphErrorBody | null;
  const error = body?.error;
  if (!error?.message) return `Facebook API error ${res.status}`;
  return error.code === undefined ? error.message : `${error.message} (code ${error.code})`;
}

export async function publishToFacebook(args: FacebookPostArgs): Promise<FacebookPostResult> {
  const message = args.message.trim();
  if (!message) throw new Error('Refusing to publish an empty message to Facebook');
  // Rejected here rather than by Meta: our own message names the limit and the
  // actual length, which its error does not.
  if (message.length > FACEBOOK_MAX_MESSAGE_CHARS) {
    throw new Error(
      `Message is ${message.length} characters; Facebook accepts at most ${FACEBOOK_MAX_MESSAGE_CHARS}`,
    );
  }

  const res = await fetch(graphUrl(`${args.pageId}/feed`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message, access_token: args.accessToken }),
  });

  if (!res.ok) throw new Error(await graphErrorMessage(res));

  const body = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) throw new Error('Facebook accepted the post but returned no id');
  // The id is a `{page-id}_{post-id}` composite, which is itself a valid path.
  return { id: body.id, url: `https://www.facebook.com/${body.id}` };
}

/** Null rather than a throw: a missing name must never block the publish UI. */
export async function fetchPageName(pageId: string, accessToken: string): Promise<string | null> {
  const params = new URLSearchParams({ fields: 'name', access_token: accessToken });
  const res = await fetch(graphUrl(`${pageId}?${params}`)).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { name?: string } | null;
  return body?.name ?? null;
}
