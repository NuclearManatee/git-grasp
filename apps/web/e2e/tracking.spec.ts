// @ts-nocheck
import { test, expect } from '@playwright/test';

/**
 * Tracking e2e: asserts events via window.__ghTrackQueue (always).
 * Queue assertions remain the source of truth for CI reliability.
 * Optional: when PUBLIC_POSTHOG_HOST is the Docker e2e proxy (:8010), also ping it.
 */
test.describe('web CLI tracking', () => {
  test('records web_cli_load and web_cli_search', async ({ page }) => {
    await page.goto('/?optin=1&mock=1', { waitUntil: 'domcontentloaded' });

    await page.getByTestId('playground').scrollIntoViewIfNeeded().catch(() => {});
    // section id is playground; overlay button
    const start = page.getByTestId('playground-start');
    await expect(start).toBeVisible({ timeout: 15_000 });
    await start.click();

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const q = window.__ghTrackQueue || [];
            return q.some((e) => e.name === 'web_cli_load' && e.data?.outcome === 'ok');
          }),
        { timeout: 60_000 },
      )
      .toBe(true);

    const term = page.getByTestId('playground-terminal');
    await expect(term).toBeVisible();
    await term.click();

    // Type a query into xterm via keyboard
    await page.keyboard.type('undo last commit keep changes staged');
    await page.keyboard.press('Enter');

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const q = window.__ghTrackQueue || [];
            return q.some((e) => e.name === 'web_cli_search' && typeof e.data?.query === 'string');
          }),
        { timeout: 30_000 },
      )
      .toBe(true);

    const events = await page.evaluate(() => window.__ghTrackQueue || []);
    const load = events.find((e) => e.name === 'web_cli_load');
    const search = events.find((e) => e.name === 'web_cli_search');

    expect(load?.data).toMatchObject({
      outcome: 'ok',
      mock: true,
    });
    expect(typeof load?.data?.duration_ms).toBe('number');
    expect(load?.data?.schema_version).toBeTruthy();
    expect(search?.data?.query).toBeTruthy();
    expect(search?.data?.response).toBeTruthy();
    expect(typeof search?.data?.latency_ms).toBe('number');
    expect(search?.data?.schema_version).toBeTruthy();

    // Spawn notice: telemetry enabled (Xterm buffer dump)
    const dump = await page.evaluate(() =>
      (typeof window.__ghPlaygroundDump === 'function' ? window.__ghPlaygroundDump() : ''),
    );
    expect(dump).toMatch(/Telemetry is enabled/);
    expect(dump.replace(/\s+/g, '')).toContain('git-grasp.cremaschi.dev/privacy');
  });

  test('Docker PostHog proxy is up when snippet host is local e2e', async ({ request }) => {
    const host = String(process.env.PUBLIC_POSTHOG_HOST || '').replace(/\/$/, '');
    test.skip(
      !/127\.0\.0\.1:8010|localhost:8010/.test(host),
      'PUBLIC_POSTHOG_HOST is not the Docker e2e proxy',
    );
    const res = await request.get(`${host}/_health`).catch(() => request.get(`${host}/`));
    expect(res.ok() || res.status() > 0).toBe(true);
  });
});
