// @ts-nocheck
/**
 * Baked Umami Cloud defaults (same property as the marketing Site).
 * Website ID is public (embedded in the Site script tag). Override for tests/self-host:
 *   GIT_GRASP_UMAMI_HOST, GIT_GRASP_UMAMI_WEBSITE_ID
 *
 * DEFAULT_UMAMI_WEBSITE_ID must match apps/web PUBLIC_UMAMI_WEBSITE_ID in production.
 * Leave empty to fail closed (no sends) until set â€” safer than guessing.
 */
export const DEFAULT_UMAMI_HOST = 'https://cloud.umami.is';

/** Match PUBLIC_UMAMI_WEBSITE_ID used by apps/web in production. */
export const DEFAULT_UMAMI_WEBSITE_ID = '';

export const TELEMETRY_TIMEOUT_MS = 2000;

export const PRIVACY_URL = 'https://git-grasp.cremaschi.dev/privacy';
