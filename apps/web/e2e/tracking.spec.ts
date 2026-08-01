// @ts-nocheck
import { test, expect } from '@playwright/test';

/**
 * Tracking e2e: asserts events via window.__ghTrackQueue (always).
 * When PUBLIC_UMAMI_* points at local Docker Umami, the script also loads;
 * queue assertions remain the source of truth for CI reliability.
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
    expect(search?.data?.query).toBeTruthy();
    expect(search?.data?.response).toBeTruthy();
    expect(typeof search?.data?.latency_ms).toBe('number');

    // Optional: hit local Umami if configured
    const umamiUrl = process.env.PUBLIC_UMAMI_SCRIPT_URL;
    if (umamiUrl && umamiUrl.includes('3001')) {
      const res = await page.request.get('http://127.0.0.1:3001/api/heartbeat').catch(() => null);
      expect(res?.ok() || res?.status() === 200 || res?.status() === 401).toBeTruthy();
    }
  });
});
