import { test } from '@playwright/test';
import { expectAccessible, expectNoHorizontalScroll, PHONE, signInAs } from './helpers.ts';

const LANGS = [
  { code: 'en', label: 'English', pay: 'Pay', help: 'Help', hours: 'Hours' },
  { code: 'ta', label: 'தமிழ்', pay: 'சம்பளம்', help: 'உதவி', hours: 'நேரம்' },
  { code: 'hi', label: 'हिन्दी', pay: 'वेतन', help: 'मदद', hours: 'घंटे' },
];

for (const lang of LANGS) {
  test(`worker screens pass axe and fit a 360px phone in ${lang.label}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signInAs(page, 'ravi');
    await page.getByRole('button', { name: lang.label }).click();
    for (const tab of [null, lang.hours, lang.pay, lang.help]) {
      if (tab) await page.getByRole('link', { name: tab, exact: true }).click();
      await page.waitForLoadState('networkidle');
      await expectAccessible(page);
      await expectNoHorizontalScroll(page);
    }
  });
}

test('sign-in, confidential report and tracking pages pass axe', async ({ page }) => {
  await page.setViewportSize(PHONE);
  for (const path of ['/', '/report/STHAPATI', '/track']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
  }
});

test('employer console pages pass axe', async ({ page }) => {
  await signInAs(page, 'lakshmi');
  for (const name of ['Overview', 'Workforce', 'Shifts', 'Pay & time requests', 'Safety & grievances', 'Pay rules', 'Audit trail']) {
    await page.getByRole('link', { name }).click();
    await page.waitForLoadState('networkidle');
    await expectAccessible(page);
  }
});
