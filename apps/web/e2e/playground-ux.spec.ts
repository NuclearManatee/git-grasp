// @ts-nocheck
import { test, expect } from '@playwright/test';

const SEARCH_FALLBACK_MESSAGE =
  'No confident match. Try rephrasing, or run git help.';

async function startPlayground(page) {
  await page.goto('/?optin=1&mock=1', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('playground').scrollIntoViewIfNeeded().catch(() => {});
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

  await expect(page.getByTestId('playground-terminal')).toBeVisible();
}

async function terminalDump(page) {
  return page.evaluate(() => {
    if (typeof window.__ghPlaygroundDump === 'function') {
      return window.__ghPlaygroundDump();
    }
    return '';
  });
}

async function typeLine(page, text) {
  await page.getByTestId('playground-terminal').click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test.describe('playground UX parity', () => {
  test('spawns with telemetry-on notice', async ({ page }) => {
    await startPlayground(page);

    await expect
      .poll(async () => terminalDump(page), { timeout: 10_000 })
      .toMatch(/Telemetry is enabled/);

    const dump = await terminalDump(page);
    expect(dump.replace(/\s+/g, '')).toContain('git-grasp.cremaschi.dev/privacy');
    expect(dump).toContain('Ready. Search will use the local model and catalog.');
  });

  test('help lists playground commands and CLI-only note', async ({ page }) => {
    await startPlayground(page);
    await typeLine(page, 'help');

    await expect
      .poll(async () => terminalDump(page), { timeout: 10_000 })
      .toMatch(/telemetry status/);

    const dump = await terminalDump(page);
    expect(dump).toContain('Common commands:');
    expect(dump).toContain('-c / --copy');
    expect(dump).toContain('CLI-only:');
    expect(dump).toMatch(/doctor/);
    // Help must not claim doctor is runnable in the REPL as a working command line
    expect(dump).not.toMatch(/^\s+doctor\s/m);
  });

  test('set-level uses parked skill copy', async ({ page }) => {
    await startPlayground(page);
    await typeLine(page, 'set-level beginner');

    await expect
      .poll(async () => terminalDump(page), { timeout: 10_000 })
      .toMatch(/Does not change search results yet/);
  });

  test('telemetry status reports on', async ({ page }) => {
    await startPlayground(page);
    await typeLine(page, 'telemetry status');

    await expect
      .poll(async () => terminalDump(page), { timeout: 10_000 })
      .toMatch(/Telemetry:\s*on/);
  });

  test('empty-ish query still renders via shared formatter path', async ({ page }) => {
    await startPlayground(page);
    // Nonsense query should often hit red/empty alert with mock embeddings
    await typeLine(page, 'zzzzzxqwyvnotagitcommand999');

    await expect
      .poll(
        async () => {
          const dump = await terminalDump(page);
          return (
            dump.includes(SEARCH_FALLBACK_MESSAGE)
            || dump.includes('Searching')
            || dump.length > 50
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    const events = await page.evaluate(() => window.__ghTrackQueue || []);
    const search = events.find((e) => e.name === 'web_cli_search');
    expect(search?.data?.schema_version).toBeTruthy();
  });
});
