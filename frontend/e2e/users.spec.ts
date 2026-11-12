import { type Browser, type Page, expect as baseExpect, test } from '@playwright/test';
import {
  PASSWORD,
  createCompany,
  login,
  newAccount,
  readInviteLinkFromMailpit,
  register,
  resetRateLimits,
} from './helpers';

/** Pages under test compile on first visit in `next dev`; client data may take longer than 5 s. */
const expect = baseExpect.configure({ timeout: 15_000 });

/** Same-origin BFF write as the signed-in page would send it (CSRF header + Origin). */
async function bffPost(page: Page, path: string, data: unknown) {
  const origin = new URL(page.url()).origin;
  return page.request.post(`/api/bff/${path}`, {
    headers: { Origin: origin, 'x-tm-csrf': '1' },
    data,
  });
}

async function inviteThroughDialog(page: Page, email: string, company: string) {
  await page.goto('/users');
  await expect(page.getByRole('heading', { name: 'Kullanıcılar' })).toBeVisible();
  // The table is client data: once it shows, the page is hydrated.
  await expect(page.getByText('(siz)')).toBeVisible();
  await page.getByRole('button', { name: 'Kullanıcı davet et' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('combobox', { name: 'Firma 1' }).click();
  await page.getByRole('option', { name: company }).click();
  await dialog.getByRole('combobox', { name: 'Rol 1' }).click();
  await page.getByRole('option', { name: 'Muhasebe' }).click();
  await dialog.getByRole('button', { name: 'Davet gönder' }).click();
  await expect(page.getByText('Davet gönderildi')).toBeVisible();
  await expect(dialog).toBeHidden();
}

async function acceptAsNewAccount(browser: Browser, email: string) {
  const link = await readInviteLinkFromMailpit(email);
  const context = await browser.newContext();
  const page = await context.newPage();
  await resetRateLimits();
  await page.goto(link);
  await expect(page.getByText(/mağazasına davet$/)).toBeVisible();
  await page.getByLabel('Ad soyad').fill('Mehmet Muhasebe');
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Hesap oluştur ve katıl' }).click();
  await expect(page.getByText(/mağazasına katıldınız$/)).toBeVisible();
  await page.getByRole('link', { name: 'Giriş yap' }).click();
  await login(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
  return { context, page };
}

test.describe('users and invitations', () => {
  // Two accounts, an e-mail round trip and first-visit compiles: longer than the default.
  test.describe.configure({ timeout: 120_000 });
  test('owner invites an accountant for company A; the invitee sees only A', async ({
    page,
    browser,
  }) => {
    await register(page, newAccount('owner'));
    const a = `A Firması ${Date.now()}`;
    const b = `B Firması ${Date.now()}`;
    await createCompany(page, a);
    const bId = await createCompany(page, b);

    const invitee = newAccount('muhasebe').email;
    await inviteThroughDialog(page, invitee, a);

    const { context, page: other } = await acceptAsNewAccount(browser, invitee);
    await other.goto('/companies');
    await expect(other.getByRole('link', { name: a })).toBeVisible();
    await expect(other.getByRole('link', { name: b })).toHaveCount(0);
    // No direct access to B either; the backend hides it as not found.
    expect((await other.request.get(`/api/bff/companies/${bId}`)).status()).toBe(404);
    // The accountant does not manage users.
    expect((await other.request.get('/api/bff/users')).status()).toBe(403);

    // The owner sees the new member with company A access.
    await page.goto('/users');
    const row = page.getByRole('row', { name: /Mehmet Muhasebe/ });
    await expect(row).toContainText(invitee);
    await expect(row).toContainText(a);
    await expect(row).toContainText('Muhasebe');
    await context.close();
  });

  test('revoked invitation link shows the invalid page', async ({ page }) => {
    await register(page, newAccount('revoke'));
    const companyId = await createCompany(page, `İptal Firması ${Date.now()}`);
    const email = newAccount('iptal').email;
    const created = await bffPost(page, 'invitations', {
      email,
      companyRoles: [{ companyId, roleKey: 'viewer' }],
    });
    expect(created.status()).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };
    const link = await readInviteLinkFromMailpit(email);

    const revoked = await bffPost(page, `invitations/${data.id}/revoke`, {});
    expect(revoked.ok()).toBe(true);

    await resetRateLimits();
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Davet açılamadı' })).toBeVisible();
    await expect(
      page.getByText('Bu davet bağlantısı geçersiz veya süresi dolmuş.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /katıl|kabul/ })).toHaveCount(0);
  });

  test('deactivated user is signed out on the next action', async ({ page, browser }) => {
    await register(page, newAccount('deact'));
    const company = `Pasif Deneme ${Date.now()}`;
    await createCompany(page, company);
    const invitee = newAccount('pasif').email;
    await inviteThroughDialog(page, invitee, company);
    const { context, page: other } = await acceptAsNewAccount(browser, invitee);
    await other.goto('/companies');
    await expect(other.getByRole('link', { name: company })).toBeVisible();

    await page.goto('/users');
    await page.getByRole('button', { name: 'Mehmet Muhasebe işlemleri' }).click();
    await page.getByRole('menuitem', { name: 'Pasife al' }).click();
    await expect(page.getByText('Kullanıcı pasife alındı')).toBeVisible();
    await expect(page.getByRole('row', { name: /Mehmet Muhasebe/ })).toContainText(
      'Pasif',
    );

    // Next action of the open session: it ends and lands on the login page.
    await other.getByRole('link', { name: company }).click();
    await expect(other).toHaveURL(/\/login/);
    expect((await other.request.get('/api/session')).status()).toBe(401);

    // Signing in again is refused as well.
    await resetRateLimits();
    await login(other, invitee);
    await expect(other).not.toHaveURL(/\/dashboard$/);
    await context.close();
  });
});
