import { expect, test } from '@playwright/test';
import { newAccount, register } from './helpers';

test('mobile: navigation drawer and company cards', async ({ page }) => {
  await register(page, newAccount('mobile'));
  await expect(page.getByRole('navigation', { name: 'Ana menü' })).toBeHidden();
  // Client data has loaded, so the page is hydrated and the menu button is live.
  await expect(page.getByText('Henüz firma eklenmedi')).toBeVisible();
  await page.getByRole('button', { name: 'Menüyü aç' }).click();
  await page.getByRole('link', { name: 'Firmalar' }).click();
  await expect(page).toHaveURL(/\/companies$/);
  await expect(page.getByRole('heading', { name: 'Firmalar' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
