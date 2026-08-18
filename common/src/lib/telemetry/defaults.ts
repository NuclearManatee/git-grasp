// @ts-nocheck
/**
 * Baked PostHog EU Cloud defaults (same project as the marketing Site).
 * Project API key is public (embedded in the Site snippet). Empty key disables send
 * until a project is created. Override for tests:
 *   GIT_GRASP_POSTHOG_HOST, GIT_GRASP_POSTHOG_KEY
 * Web overrides via PUBLIC_POSTHOG_HOST / PUBLIC_POSTHOG_KEY.
 * EVOLVE pull uses GIT_GRASP_POSTHOG_API_HOST + PROJECT_ID + PERSONAL_API_KEY.
 */
export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

export const DEFAULT_POSTHOG_API_HOST = 'https://eu.posthog.com';

/** Public project API key (`phc_…`). Empty until the PostHog project is created. */
export const DEFAULT_POSTHOG_KEY = '';

/** Local Docker PostHog for telemetry / EVOLVE e2e (`apps/web/docker-compose.posthog.yml`). */
export const DEFAULT_POSTHOG_E2E_HOST = 'http://127.0.0.1:8010';

export const TELEMETRY_TIMEOUT_MS = 2000;

export const PRIVACY_URL = 'https://git-grasp.cremaschi.dev/privacy';
