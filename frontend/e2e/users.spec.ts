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
  await expect(page.getByText('(siz)').filter({ visible: true })).toBeVisible();
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

  test('pending invitations panel resends and revokes (USR-T13b)', async ({ page }) => {
    await register(page, newAccount('panel'));
    const companyId = await createCompany(page, `Panel Firması ${Date.now()}`);
    const email = newAccount('panel-davet').email;
    const created = await bffPost(page, 'invitations', {
      email,
      companyRoles: [{ companyId, roleKey: 'accounting' }],
    });
    expect(created.status()).toBe(201);

    await page.goto('/users');
    const panel = page.getByRole('region', { name: 'Bekleyen davetler' });
    const row = panel.getByRole('listitem').filter({ hasText: email });
    await expect(row).toBeVisible();
    await expect(row.getByText('Muhasebe · 1 firma', { exact: false })).toBeVisible();

    await resetRateLimits();
    await row.getByRole('button', { name: 'Yeniden gönder' }).click();
    await expect(page.getByText(`${email} adresine davet yeniden gönderildi`)).toBeVisible();

    await row.getByRole('button', { name: 'İptal et' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Daveti iptal et' }).click();
    await expect(page.getByText('Davet iptal edildi')).toBeVisible();
    await expect(panel.getByText(email)).toHaveCount(0);
  });

  test('a signed-in invitee accepts without a password and switches store (USR-T13b)', async ({
    page,
    browser,
  }) => {
    await register(page, newAccount('as-current-owner'));
    const companyId = await createCompany(page, `Oturumlu Firma ${Date.now()}`);
    // The invitee already has an account (an own store) and is signed in.
    const invitee = newAccount('as-current');
    const context = await browser.newContext();
    const inviteePage = await context.newPage();
    await register(inviteePage, invitee);

    expect(
      (
        await bffPost(page, 'invitations', {
          email: invitee.email,
          companyRoles: [{ companyId, roleKey: 'viewer' }],
        })
      ).status(),
    ).toBe(201);
    const link = await readInviteLinkFromMailpit(invitee.email);

    await resetRateLimits();
    await inviteePage.goto(link);
    await expect(inviteePage.getByText(`${invitee.email} hesabıyla oturum açıksınız.`)).toBeVisible();
    await expect(inviteePage.getByLabel(/şifre/i)).toHaveCount(0);
    await inviteePage.getByRole('button', { name: 'Bu hesapla kabul et' }).click();
    await expect(inviteePage.getByText(/mağazasına katıldınız$/)).toBeVisible();
    await inviteePage.getByRole('button', { name: 'Mağazaya geç' }).click();
    await expect(inviteePage).toHaveURL(/\/dashboard$/);
    await context.close();
  });

  test('another signed-in account is told the invitation is not theirs (USR-T13b)', async ({
    page,
    browser,
  }) => {
    await register(page, newAccount('other-owner'));
    const companyId = await createCompany(page, `Başka Hesap ${Date.now()}`);
    const invited = newAccount('other-invited');
    const existing = newAccount('other-signed-in');
    // The invited address must have an account, or the page shows the sign-up form.
    const invitedContext = await browser.newContext();
    await register(await invitedContext.newPage(), invited);
    await invitedContext.close();
    const context = await browser.newContext();
    const otherPage = await context.newPage();
    await register(otherPage, existing);

    expect(
      (
        await bffPost(page, 'invitations', {
          email: invited.email,
          companyRoles: [{ companyId, roleKey: 'viewer' }],
        })
      ).status(),
    ).toBe(201);
    const link = await readInviteLinkFromMailpit(invited.email);

    await resetRateLimits();
    await otherPage.goto(link);
    await otherPage.getByRole('button', { name: 'Bu hesapla kabul et' }).click();
    await expect(otherPage.getByRole('heading', { name: 'Davet başka bir hesaba ait' })).toBeVisible();
    await expect(otherPage.getByRole('button', { name: 'Çıkış yap' })).toBeVisible();
    await context.close();
  });

  test('role change in an open tab takes effect without signing out (USR-T15b)', async ({
    page,
    browser,
  }) => {
    await register(page, newAccount('role-owner'));
    const company = `Rol Firması ${Date.now()}`;
    const companyId = await createCompany(page, company);
    const invitee = newAccount('rol').email;
    const created = await bffPost(page, 'invitations', {
      email: invitee,
      companyRoles: [{ companyId, roleKey: 'operations' }],
    });
    expect(created.status()).toBe(201);
    const { context, page: other } = await acceptAsNewAccount(browser, invitee);
    const product = (name: string) =>
      bffPost(other, 'products', { companyId, name, variants: [{ sku: `${name}-${Date.now()}` }] });
    expect((await product('once')).status()).toBe(201);

    const members = (await (await page.request.get('/api/bff/users')).json()) as {
      data: { userId: string; email: string }[];
    };
    const userId = members.data.find((m) => m.email === invitee)!.userId;
    const changed = await page.request.put(`/api/bff/users/${userId}/access`, {
      headers: { Origin: new URL(page.url()).origin, 'x-tm-csrf': '1' },
      data: { companyRoles: [{ companyId, roleKey: 'viewer' }] },
    });
    expect(changed.ok()).toBe(true);

    // Same tab, same session: reading still works, writing no longer does.
    expect((await product('sonra')).status()).toBe(403);
    await other.goto('/companies');
    await expect(other.getByRole('link', { name: company })).toBeVisible();
    expect((await other.request.get('/api/session')).status()).toBe(200);
    await context.close();
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
