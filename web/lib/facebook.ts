import type { Messages } from '../i18n/index';
import { errorMessage } from './errors';

/**
 * POST a draft to Facebook, returning the post url on success or a
 * ready-to-display error string on failure.
 *
 * Extracted from the button so the request path — which guards a public,
 * irreversible action — can be tested. `web/tests/` renders with
 * `renderToStaticMarkup` and has no DOM, so a click handler is unreachable
 * there; a plain async function is not.
 */
export async function postDraftToFacebook(
  draftId: string,
  messages: Messages,
): Promise<{ url: string } | { error: string }> {
  try {
    const res = await fetch(`/api/drafts/${draftId}/publish/facebook`, { method: 'POST' });
    if (res.ok) return (await res.json()) as { url: string };
    return { error: await errorMessage(res, messages.errors.facebookPublishFailed, messages) };
  } catch {
    // An offline or aborted request rejects before any response exists. Without
    // this the button would sit disabled reading "Posting…" with nothing said.
    return { error: messages.errors.facebookPublishFailed };
  }
}
