// @ts-nocheck
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('accessibility', () => {
  test('home page has no serious a11y violations', async ({ page }) => {
    await page.goto('/?optin=1&mock=1', { waitUntil: 'domcontentloaded' });
    const results = await new AxeBuilder({ page })
      .disableRules(['color-contrast']) // terminal / mono theme intentional
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });

  test('privacy page has no serious a11y violations', async ({ page }) => {
    await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
    const results = await new AxeBuilder({ page })
      .disableRules(['color-contrast'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
});
