import { expect, test } from '@playwright/test';
import { PHONE, signInAs } from './helpers.ts';

test.describe.serial('Journey A: construction wage discrepancy', () => {
  test('worker sees the gap in Fairness Replay and asks for a check', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signInAs(page, 'ravi');
    await page.getByRole('link', { name: 'Pay', exact: true }).click();
    const verdict = page.getByTestId('verdict');
    await expect(verdict).toContainText('Payroll is ₹1,200.00 less than your records.');
    await expect(verdict).toContainText('overtime pay');
    await expect(page.locator('[data-step="overtime_pay"]')).toContainText('× 2×');
    await page.getByRole('button', { name: 'This looks wrong. Ask for a check' }).click();
    await page.getByLabel('Anything to add?').fill('Overtime on weekdays looks short.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Request sent.')).toBeVisible();
  });

  test('employer reviews the evidence and records a correction', async ({ page }) => {
    await signInAs(page, 'lakshmi');
    await expect(page.getByText('Ravi Kumar asked for a pay check')).toBeVisible();
    await page.getByRole('link', { name: 'Pay & time requests' }).click();
    await page.getByRole('link', { name: 'Ravi Kumar' }).click();
    await expect(page.getByText('Payroll is ₹1,200.00 less than your records.')).toBeVisible();
    await page.getByLabel('Reason the worker will read').fill('Site register confirms the overtime. Top-up approved.');
    await page.getByRole('button', { name: 'Record decision' }).click();
    await expect(page.getByText('Decision recorded.')).toBeVisible();
    await expect(page.getByText('Payroll matches your records.')).toBeVisible();
  });

  test('worker sees the corrected outcome and the kept history', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signInAs(page, 'ravi');
    await page.getByRole('link', { name: 'Pay', exact: true }).click();
    await expect(page.getByTestId('verdict')).toContainText('Payroll matches your records.');
    await expect(page.getByText('Your request: Corrected')).toBeVisible();
    await page.getByText('Payroll versions').click();
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
    await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
  });

  test('audit chain verifies after the workflow', async ({ page }) => {
    await signInAs(page, 'lakshmi');
    await page.getByRole('link', { name: 'Audit trail' }).click();
    await page.getByRole('button', { name: 'Verify the whole chain' }).click();
    await expect(page.getByText(/Chain intact: \d+ entries checked/)).toBeVisible();
  });
});

test.describe.serial('Journey B: college confidential safety report', () => {
  let code = '';

  test('worker files a confidential report and gets a tracking code', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signInAs(page, 'priya');
    await page.getByRole('link', { name: 'Help', exact: true }).click();
    await page.getByRole('radio', { name: 'Danger at work' }).check();
    await page.getByLabel('Say a few words').fill('Loose floor tile on the hostel B staircase.');
    await page.getByRole('radio', { name: /Keep my name out/ }).check();
    await page.getByRole('button', { name: 'Send report' }).click();
    code = (await page.getByTestId('tracking-code').innerText()).trim();
    expect(code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  });

  test('facilities admin sees the report without the reporter and acts on it', async ({ page }) => {
    await signInAs(page, 'anita');
    await page.getByRole('link', { name: 'Safety & grievances' }).click();
    const row = page.getByRole('row', { name: /Loose floor tile/ });
    await expect(row).toContainText('Confidential');
    await expect(row).not.toContainText('Priya');
    await row.getByRole('link').click();
    await page.getByLabel('Note', { exact: true }).fill('Area taped off. Tile replacement booked for Monday.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Update saved.')).toBeVisible();
  });

  test('the code holder sees the response without signing in', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/track');
    await page.getByLabel('Tracking code').fill(code);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Seen by employer').first()).toBeVisible();
    await expect(page.getByText('Area taped off. Tile replacement booked for Monday.')).toBeVisible();
  });
});

test.describe('Journey C: inclusive worker experience', () => {
  test('a Hindi-speaking guard checks in and reports an urgent danger without typing', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signInAs(page, 'selvam');
    await page.getByRole('button', { name: 'हिन्दी' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await page.getByRole('button', { name: 'हाज़िरी लगाएँ' }).click();
    await expect(page.getByText('हाज़िरी लग गई। सुरक्षित काम करें।')).toBeVisible();
    await page.getByRole('link', { name: 'मदद', exact: true }).click();
    await page.getByRole('radio', { name: 'काम पर खतरा' }).check();
    await page.getByRole('checkbox', { name: 'अभी किसी को चोट लग सकती है' }).check();
    await page.getByRole('button', { name: 'शिकायत भेजें' }).click();
    await expect(page.getByText('शिकायत भेज दी।')).toBeVisible();
  });

  test('the pay explanation reads in Tamil', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signInAs(page, 'selvam');
    await page.getByRole('button', { name: 'தமிழ்' }).click();
    await page.getByRole('link', { name: 'சம்பளம்', exact: true }).click();
    await expect(page.locator('[data-step="night_allowance"]')).toContainText('இரவுப் பணிகள்');
    await expect(page.getByTestId('verdict')).toContainText('பொருந்துகிறது');
  });

  test('a missed check-out can be fixed from the phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signInAs(page, 'suresh');
    await page.getByRole('link', { name: 'Fix this shift' }).click();
    await page.getByRole('button', { name: 'Tell us when you left' }).click();
    await page.getByLabel('I left at').fill('16:10');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Sent. Your employer will check')).toBeVisible();
  });

  test('a report can be filed with the keyboard alone', async ({ page }) => {
    await page.goto('/report/GREENFIELD');
    const tabTo = async (selector: string) => {
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        if (await page.locator(selector).evaluate((el) => el === document.activeElement)) return;
      }
      throw new Error(`could not reach ${selector} with Tab`);
    };
    await tabTo('input[value="hazard"]');
    await page.keyboard.press('Space');
    await tabTo('input[type="checkbox"]');
    await page.keyboard.press('Space');
    await tabTo('button[type="submit"]');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tracking-code')).toBeVisible();
  });

  test('the confidential form warns before naming a small site', async ({ page }) => {
    await page.goto('/report/GREENFIELD');
    await page.getByRole('radio', { name: 'Broken equipment' }).check();
    const site = page.getByLabel('Where');
    await site.selectOption({ label: 'Maintenance' });
    await expect(site).toHaveAccessibleDescription(/Few people work here/);
    await site.selectOption({ label: 'Security' });
    await expect(page.getByText(/Few people work here/)).toHaveCount(0);
  });

  test('the chosen language follows the worker to a new phone', async ({ browser }) => {
    const first = await browser.newPage();
    await signInAs(first, 'priya');
    await first.getByRole('button', { name: 'தமிழ்' }).click();
    await expect(first.locator('html')).toHaveAttribute('lang', 'ta');
    await first.close();

    const second = await browser.newPage(); // fresh storage, like a new phone
    await second.goto('/');
    await second.locator('[data-username="priya"]').click();
    await expect(second.locator('html')).toHaveAttribute('lang', 'ta');
    await second.close();
  });
});
