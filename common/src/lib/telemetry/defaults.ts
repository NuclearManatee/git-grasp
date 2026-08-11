// @ts-nocheck
/**
 * Baked Umami Cloud defaults (same property as the marketing Site).
 * Website ID is public (embedded in the Site script tag). Override for tests/self-host:
 *   GIT_GRASP_UMAMI_HOST, GIT_GRASP_UMAMI_WEBSITE_ID
 * Web overrides via PUBLIC_UMAMI_SCRIPT_URL / PUBLIC_UMAMI_WEBSITE_ID.
 */
export const DEFAULT_UMAMI_HOST = 'https://cloud.umami.is';

/** Script URL used by the Site (`data-website-id` companion). */
export const DEFAULT_UMAMI_SCRIPT_URL = `${DEFAULT_UMAMI_HOST}/script.js`;

/** Match PUBLIC_UMAMI_WEBSITE_ID used by apps/web in production. */
export const DEFAULT_UMAMI_WEBSITE_ID = 'de9735ab-4e95-479d-abf8-c52f7979e2aa';

export const TELEMETRY_TIMEOUT_MS = 2000;

export const PRIVACY_URL = 'https://git-grasp.cremaschi.dev/privacy';
