#!/usr/bin/env bun
// @ts-nocheck
/**
 * Seed local Docker Umami for EVOLVE e2e: login, ensure website, print env exports.
 *
 * Prerequisites:
 *   docker compose -f apps/web/docker-compose.umami.yml --profile e2e up -d
 *
 * Usage:
 *   bun run evolve:seed-umami
 */
import {
  resolveUmamiPullConfig,
  resolveUmamiAuthToken,
  listUmamiWebsites,
  createUmamiWebsite,
} from '@git-grasp/common/evolve';

async function main() {
  const cfg = resolveUmamiPullConfig(process.env);
  console.log(`Umami host: ${cfg.host}`);

  // Wait for readiness
  let ok = false;
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await fetch(`${cfg.host}/`, { signal: AbortSignal.timeout(2000) });
      if (res.status > 0) {
        ok = true;
        break;
      }
    } catch {
      /* retry */
    }
    await Bun.sleep(1000);
  }
  if (!ok) {
    console.error('Umami not reachable. Start: docker compose -f apps/web/docker-compose.umami.yml --profile e2e up -d');
    process.exit(1);
  }

  const token = await resolveUmamiAuthToken({
    host: cfg.host,
    token: cfg.token,
    username: cfg.username,
    password: cfg.password,
  });

  let websites = [];
  try {
    const listed = await listUmamiWebsites({ host: cfg.host, token });
    websites = Array.isArray(listed) ? listed : listed?.data || [];
  } catch (err) {
    console.warn('list websites failed:', err?.message || err);
  }

  let website = websites.find((w) => w.name === 'git-grasp-e2e' || w.domain === 'localhost');
  if (!website) {
    website = await createUmamiWebsite({
      host: cfg.host,
      token,
      name: 'git-grasp-e2e',
      domain: 'localhost',
    });
  }

  const id = website.id || website.websiteId;
  console.log('\n# Export for evolve / e2e:\n');
  console.log(`export GIT_GRASP_UMAMI_HOST=${cfg.host}`);
  console.log(`export GIT_GRASP_UMAMI_WEBSITE_ID=${id}`);
  console.log(`export GIT_GRASP_UMAMI_TOKEN=${token}`);
  console.log(`# or login: GIT_GRASP_UMAMI_USERNAME=${cfg.username} GIT_GRASP_UMAMI_PASSWORD=***`);
  console.log(JSON.stringify({ websiteId: id, host: cfg.host }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
