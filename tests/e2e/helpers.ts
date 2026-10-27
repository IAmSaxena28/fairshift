import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const PHONE = { width: 360, height: 740 };

/** Signs in on a phone that has already been used in English, so earlier tests' saved account languages do not leak in. */
export async function signInAs(page: Page, username: string) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('fairshift.lang')) localStorage.setItem('fairshift.lang', 'en');
  });
  await page.goto('/');
  await page.locator(`[data-username="${username}"]`).click();
  await expect(page.locator('main#main')).toBeVisible();
}

/** Fails on any serious or critical WCAG 2.1 A/AA violation reported by axe-core. */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
