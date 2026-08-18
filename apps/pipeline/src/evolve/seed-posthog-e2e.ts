#!/usr/bin/env bun
/**
 * Seed local Docker PostHog for EVOLVE e2e: signup/login, print env exports.
 *
 *   docker compose -f apps/web/docker-compose.posthog.yml --profile e2e up -d
 *   bun run evolve:seed-posthog
 */
import { DEFAULT_POSTHOG_E2E_HOST } from '../../../../common/src/lib/telemetry/defaults.ts';
import {
  ensurePosthogE2eProject,
  posthogReachable,
} from '../../../../common/src/evolve/posthogPull.ts';

const host = (process.env.GIT_GRASP_POSTHOG_HOST || DEFAULT_POSTHOG_E2E_HOST).replace(
  /\/$/,
  '',
);

console.log(`PostHog host: ${host}`);

const ready = await posthogReachable(host, 3000);
if (!ready) {
  // First boot is slow; wait up to 3 minutes.
  const deadline = Date.now() + 180_000;
  let ok = false;
  while (Date.now() < deadline) {
    await Bun.sleep(2000);
    ok = await posthogReachable(host, 2000);
    if (ok) break;
  }
  if (!ok) {
    console.error(
      'PostHog not reachable. Start: docker compose -f apps/web/docker-compose.posthog.yml --profile e2e up -d',
    );
    process.exit(1);
  }
}

try {
  const seeded = await ensurePosthogE2eProject({ host });
  console.log(`export GIT_GRASP_POSTHOG_HOST=${host}`);
  console.log(`export GIT_GRASP_POSTHOG_API_HOST=${host}`);
  console.log(`export GIT_GRASP_POSTHOG_KEY=${seeded.projectApiKey}`);
  console.log(`export GIT_GRASP_POSTHOG_PROJECT_ID=${seeded.projectId}`);
  console.log(`export GIT_GRASP_POSTHOG_PERSONAL_API_KEY=${seeded.personalApiKey}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
