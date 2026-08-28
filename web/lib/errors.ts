import type { Messages } from '../i18n/index';

/**
 * API error codes to catalogue entries.
 *
 * The API sends a stable code plus English prose; the dashboard translates the
 * code and falls back to the prose. A code added on the server without a
 * translation therefore degrades to readable English rather than to nothing,
 * which matters because the code list will drift as endpoints are added.
 */
const CODES: Record<string, (m: Messages) => string> = {
  unauthorized: (m) => m.errors.unauthorized,
  password_required: (m) => m.errors.passwordRequired,
  invalid_password: (m) => m.errors.invalidPassword,
  brand_not_found: (m) => m.errors.brandNotFound,
  brand_inactive: (m) => m.errors.brandInactive,
  brand_has_no_sources: (m) => m.errors.brandHasNoSources,
  brand_paste_only: (m) => m.errors.brandPasteOnly,
  brand_is_default: (m) => m.errors.brandIsDefault,
  draft_not_found: (m) => m.errors.draftNotFound,
  run_not_found: (m) => m.errors.runNotFound,
  run_not_awaiting: (m) => m.errors.runNotAwaiting,
  notion_not_configured: (m) => m.errors.notionNotConfigured,
  publish_failed: (m) => m.errors.publishFailed,
  facebook_not_configured: (m) => m.errors.facebookNotConfigured,
  facebook_already_published: (m) => m.errors.facebookAlreadyPublished,
  facebook_publish_failed: (m) => m.errors.facebookPublishFailed,
};

/** Null when the code is unknown, so the caller can fall back to server prose. */
export function messageForCode(code: string, messages: Messages): string | null {
  return CODES[code]?.(messages) ?? null;
}

/**
 * Turn a failed `Response` from the API into something worth showing a user.
 *
 * Client-safe: unlike `lib/api.ts` this imports nothing from `next/headers`, so
 * both Client Components and Server Components can use it. Every screen that
 * calls `/api/*` should route its failures through here, otherwise status
 * handling (401 in particular) drifts between screens.
 */
export async function errorMessage(
  res: Response,
  fallback: string,
  messages: Messages,
): Promise<string> {
  if (res.status === 401) return messages.errors.sessionExpired;

  const body = (await res.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;

  if (typeof body?.error === 'string') {
    const translated = messageForCode(body.error, messages);
    if (translated) return translated;
    // An unmapped code: the server's prose beats showing a raw identifier.
    if (typeof body.message === 'string') return body.message;
  }
  return `${fallback} (HTTP ${res.status})`;
}
