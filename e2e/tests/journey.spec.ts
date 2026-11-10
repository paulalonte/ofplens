import { expect, test, type Page } from '@playwright/test';

/**
 * The MVP end to end: real web app, real API, real Postgres (fresh per run), fake SimBrief.
 * Tests run in order and share the database, like one pilot using the app.
 */
test.describe.configure({ mode: 'serial' });

const PLAN_URL = /\/history\/[0-9a-f-]{36}(\?.*)?$/;

async function saveSettings(page: Page, username: string, unit: 'kg' | 'lb') {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await page.getByLabel('SimBrief username').fill(username);
  await page.getByRole('radio', { name: unit }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();
}

async function goHome(page: Page) {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'OFP Lens' })
    .click();
  await expect(page.getByRole('button', { name: 'Load latest plan' })).toBeVisible();
}

test('a new pilot is asked for their SimBrief username first', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('status').filter({ hasText: 'API ok, DB up' })).toBeVisible();
  await expect(page.getByText('Set your SimBrief username first.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load latest plan' })).toBeDisabled();
  await expect(page.getByText('For flight simulation use only.')).toBeVisible();
});

test('load a plan, find it in History, open it, delete it', async ({ page }) => {
  await page.goto('/');
  await saveSettings(page, 'e2epilot', 'kg');
  await goHome(page);

  // Load: fetched from (fake) SimBrief, saved, and opened.
  await page.getByRole('button', { name: 'Load latest plan' }).click();
  await expect(page).toHaveURL(PLAN_URL);
  await expect(page.getByText('Saved to your history.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('N70P');
  const fuel = page.getByRole('region', { name: 'Fuel' });
  await expect(fuel).toContainText('2,432 kg');
  const planUrl = new URL(page.url()).pathname;

  // The kg/lb toggle converts every weight.
  await page.getByRole('button', { name: 'lb', exact: true }).click();
  await expect(fuel).toContainText('5,362 lb');

  // Loading again finds the same plan instead of saving a copy.
  await goHome(page);
  await expect(page.getByRole('region', { name: 'Recent plans' })).toContainText('EDDB → EDDM');
  await page.getByRole('button', { name: 'Load latest plan' }).click();
  await expect(
    page.getByText('Already in your history. SimBrief has no newer plan for you yet.'),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(planUrl);

  // History lists it once; it opens from there, and survives a full reload.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'History' })
    .click();
  const rows = page.getByRole('main').getByRole('listitem');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('N70P');
  await expect(rows.first()).toContainText('EDDB → EDDM');
  await rows.first().getByRole('link').click();
  await expect(page).toHaveURL(PLAN_URL);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('N70P');
  await expect(page.getByRole('region', { name: 'Navigation log' })).toContainText('EDDM');

  // Delete asks first, then the plan is gone.
  await page.getByRole('button', { name: 'Delete plan' }).click();
  await expect(page.getByText('Delete this plan from your history?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByText(/No saved plans yet/)).toBeVisible();

  await page.goto(planUrl);
  await expect(page.getByRole('heading', { name: 'Plan not found' })).toBeVisible();
});

test('an unknown SimBrief user gets a clear message and a way to fix it', async ({ page }) => {
  await page.goto('/');
  await saveSettings(page, 'nobody', 'kg');
  await goHome(page);

  await page.getByRole('button', { name: 'Load latest plan' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load your latest plan');
  await expect(alert).toContainText('Unknown UserID');
  await alert.getByRole('link', { name: 'Check your username in Settings' }).click();
  await expect(page.getByLabel('SimBrief username')).toHaveValue('nobody');
});
