// @ts-nocheck
import { test, expect } from '@playwright/test';

/**
 * Catches React island failures that preview-only e2e historically missed.
 * If hydration fails, Astro leaves the "Loading playground…" fallback forever.
 */
test.describe('playground hydration', () => {
  test('React island mounts Start control (not stuck on fallback)', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto('/?optin=1&mock=1', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('playground').scrollIntoViewIfNeeded().catch(() => {});

    await expect(page.getByTestId('playground-start')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Loading playground…')).toHaveCount(0);

    const createRootMiss = pageErrors.some((e) =>
      /createRoot|does not provide an export named/i.test(e),
    );
    expect(createRootMiss, pageErrors.join('\n')).toBe(false);
  });
});
