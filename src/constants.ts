export const MAX_ITERATIONS = Number(process.env.MAX_ITERATIONS ?? 5);

/**
 * Graph API version, pinned so a Meta deprecation is a config change rather
 * than a code change. v25.0 is current as of February 2026.
 */
export const FACEBOOK_API_VERSION = process.env.FACEBOOK_API_VERSION ?? 'v25.0';

/** Facebook's published cap on a post's `message`. */
export const FACEBOOK_MAX_MESSAGE_CHARS = 63206;
