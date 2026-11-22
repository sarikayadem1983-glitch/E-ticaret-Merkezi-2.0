import { expect, test } from '@playwright/test';
import { PASSWORD, createCompany, newAccount, readInviteLinkFromMailpit, register, resetRateLimits } from './helpers';

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

test('mobile: users list renders as cards (USR-T15b)', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await register(page, newAccount('cards'));
  const company = `Kart Firması ${Date.now()}`;
  const companyId = await createCompany(page, company);
  const invitee = newAccount('cok-uzun-eposta-adresi-tasma-denemesi').email;
  const created = await page.request.post('/api/bff/invitations', {
    headers: { Origin: new URL(page.url()).origin, 'x-tm-csrf': '1' },
    data: { email: invitee, companyRoles: [{ companyId, roleKey: 'accounting' }] },
  });
  expect(created.status()).toBe(201);
  const link = await readInviteLinkFromMailpit(invitee);
  const context = await browser.newContext();
  const other = await context.newPage();
  await resetRateLimits();
  await other.goto(link);
  await other.getByLabel('Ad soyad').fill('Mehmet Muhasebe');
  await other.getByLabel('Şifre').fill(PASSWORD);
  await other.getByRole('button', { name: 'Hesap oluştur ve katıl' }).click();
  await expect(other.getByText(/mağazasına katıldınız$/)).toBeVisible();
  await context.close();

  await page.goto('/users');
  const cards = page.getByRole('list', { name: 'Kullanıcı listesi' });
  const card = cards.locator('> li').filter({ hasText: 'Mehmet Muhasebe' });
  await expect(card).toContainText(invitee);
  await expect(card).toContainText(company);
  await expect(cards.locator('> li').filter({ hasText: '(siz)' })).toBeVisible();
  await expect(page.getByRole('table')).toBeHidden();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  // Own card has no menu; the member's card edits and deactivates.
  await expect(cards.locator('> li').filter({ hasText: '(siz)' }).getByRole('button')).toHaveCount(0);
  const menu = card.getByRole('button', { name: 'Mehmet Muhasebe işlemleri' });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Erişimi düzenle' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await menu.click();
  await page.getByRole('menuitem', { name: 'Pasife al' }).click();
  await expect(page.getByText('Kullanıcı pasife alındı')).toBeVisible();
  await expect(card).toContainText('Pasif');
});
