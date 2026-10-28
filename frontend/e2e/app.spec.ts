import { expect, test } from '@playwright/test';
import { PASSWORD, login, newAccount, randomVkn, register } from './helpers';

test.describe('authentication and session', () => {
  test('redirects signed-out users to the login page', async ({ page }) => {
    await page.goto('/companies');
    await expect(page).toHaveURL(/\/login\?next=%2Fcompanies$/);
    await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible();
  });

  test('shows a generic error for wrong credentials', async ({ page }) => {
    await login(page, 'nobody-here@example.com');
    await expect(page.getByText('Email veya şifre hatalı')).toBeVisible();
  });

  test('keeps tokens out of the browser; the session cookie is HttpOnly', async ({
    page,
    context,
  }) => {
    const account = newAccount('cookie');
    await register(page, account);

    const cookies = await context.cookies();
    expect(cookies.map((c) => c.name)).toEqual(['tm_sid']);
    const [sid] = cookies;
    expect(sid.httpOnly).toBe(true);
    expect(sid.sameSite).toBe('Lax');
    expect(sid.path).toBe('/');

    expect(await page.evaluate(() => document.cookie)).not.toContain('tm_sid');
    const storage = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(storage).not.toMatch(/eyJ|token/i);

    const session = await page.request.get('/api/session');
    expect(await session.text()).not.toMatch(/accessToken|refreshToken|eyJ/);
  });

  test('rejects cross-site state-changing requests (CSRF)', async ({ page }) => {
    await register(page, newAccount('csrf'));
    const forged = await page.request.post('/api/bff/companies', {
      headers: { Origin: 'https://evil.example', 'x-tm-csrf': '1' },
      data: {},
    });
    expect(forged.status()).toBe(403);
    const noHeader = await page.request.post('/api/bff/companies', {
      headers: { Origin: 'http://localhost:3000' },
      data: {},
    });
    expect(noHeader.status()).toBe(403);
  });

  test('issues a new session id at login (no session fixation) and logout ends it', async ({
    page,
    context,
  }) => {
    const account = newAccount('fixation');
    await register(page, account);
    const first = (await context.cookies())[0].value;

    await page.getByRole('button', { name: 'Kullanıcı menüsü' }).click();
    await page.getByRole('menuitem', { name: 'Çıkış yap' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await context.cookies()).toHaveLength(0);

    // The old id is dead server-side even if an attacker kept a copy.
    await context.addCookies([
      { name: 'tm_sid', value: first, domain: 'localhost', path: '/' },
    ]);
    expect((await page.request.get('/api/session')).status()).toBe(401);

    await login(page, account.email);
    await expect(page).toHaveURL(/\/dashboard$/);
    const second = (await context.cookies()).find((c) => c.name === 'tm_sid');
    expect(second?.value).not.toBe(first);
  });
});

test.describe('company management', () => {
  test('create, view, edit, select and deactivate a company', async ({ page }) => {
    const account = newAccount('crud');
    await register(page, account);
    await expect(page.getByRole('heading', { name: 'Hoş geldiniz, Ayşe' })).toBeVisible();
    await expect(page.getByText('Henüz firma eklenmedi')).toBeVisible();

    // Create
    await page.getByRole('link', { name: 'Yeni firma' }).click();
    const vkn = randomVkn();
    await page.getByLabel('Ticari unvan').fill('Anadolu Ticaret A.Ş.');
    const wrongCheckDigit = vkn.slice(0, 9) + String((Number(vkn[9]) + 1) % 10);
    await page.getByLabel('VKN / TCKN').fill(wrongCheckDigit);
    await page.getByLabel('Vergi dairesi').fill('Kadıköy');
    await page.locator('#addressLine').fill('Moda Caddesi No: 12');
    await page.getByLabel('İlçe').fill('Kadıköy');
    await page.locator('#city').fill('İstanbul');
    await page.getByRole('button', { name: 'Firmayı kaydet' }).click();
    // Client-side check digit validation runs before any request.
    await expect(page.getByText('Vergi numarası geçersiz')).toBeVisible();
    await page.getByLabel('VKN / TCKN').fill(vkn);
    await page.getByRole('button', { name: 'Firmayı kaydet' }).click();

    // Detail
    await expect(page.getByRole('heading', { name: 'Anadolu Ticaret A.Ş.' })).toBeVisible();
    await expect(page.getByText(vkn)).toBeVisible();
    await expect(page.getByText('Aktif', { exact: true })).toBeVisible();

    // Edit
    await page.getByRole('link', { name: 'Düzenle' }).click();
    await expect(page.getByLabel('VKN / TCKN')).toBeDisabled();
    await page.locator('#city').fill('Ankara');
    await page.getByRole('button', { name: 'Değişiklikleri kaydet' }).click();
    await expect(page.getByText('Kadıköy / Ankara')).toBeVisible();

    // List and search
    await page.getByRole('link', { name: 'Firmalar' }).first().click();
    await page.getByLabel('Firma ara').fill(vkn);
    await expect(page.getByRole('link', { name: 'Anadolu Ticaret A.Ş.' })).toBeVisible();

    // Company selector
    await page.getByRole('button', { name: 'Firma seç' }).click();
    await page.getByRole('menuitem', { name: /Anadolu Ticaret A\.Ş\./ }).click();
    await expect(page.getByRole('button', { name: 'Firma seç' })).toContainText(
      'Anadolu Ticaret A.Ş.',
    );

    // Duplicate tax number
    await page.goto('/companies/new');
    await page.getByLabel('Ticari unvan').fill('Kopya Firma');
    await page.getByLabel('VKN / TCKN').fill(vkn);
    await page.getByLabel('Vergi dairesi').fill('Kadıköy');
    await page.locator('#addressLine').fill('Moda Caddesi No: 12');
    await page.getByLabel('İlçe').fill('Kadıköy');
    await page.locator('#city').fill('İstanbul');
    await page.getByRole('button', { name: 'Firmayı kaydet' }).click();
    await expect(page.getByText('Bu vergi numarasıyla kayıtlı bir firma zaten var')).toBeVisible();

    // Deactivate
    await page.goto('/companies');
    await page.getByLabel('Firma ara').fill(vkn);
    await page.getByRole('link', { name: 'Anadolu Ticaret A.Ş.' }).click();
    await page.getByRole('button', { name: 'Pasife al' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Pasife al' }).click();
    await expect(page.getByText('Bu firma pasif.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aktifleştir' })).toBeVisible();

    // Dashboard counts come from the backend
    await page.getByRole('link', { name: 'Dashboard' }).click();
    const summary = page.getByRole('region', { name: 'Firma özeti' });
    await expect(summary.getByText('Pasif firma').locator('..').locator('..')).toContainText('1');
  });

  test('another tenant cannot see the company (tenant isolation)', async ({ browser }) => {
    const owner = await browser.newContext();
    const ownerPage = await owner.newPage();
    await register(ownerPage, newAccount('iso-a'));
    const created = await ownerPage.request.post('/api/bff/companies', {
      headers: { Origin: 'http://localhost:3000', 'x-tm-csrf': '1' },
      data: {
        legalName: 'Gizli Firma Ltd. Şti.',
        taxNumber: randomVkn(),
        taxOffice: 'Çankaya',
        addressLine: 'Atatürk Bulvarı No 1',
        district: 'Çankaya',
        city: 'Ankara',
      },
    });
    expect(created.status()).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await register(otherPage, newAccount('iso-b'));
    await otherPage.goto(`/companies/${data.id}`);
    await expect(otherPage.getByText('Firma bulunamadı')).toBeVisible();
    const api = await otherPage.request.get(`/api/bff/companies/${data.id}`);
    expect(api.status()).toBe(404);
    const list = await otherPage.request.get('/api/bff/companies?search=Gizli');
    expect(((await list.json()) as { data: unknown[] }).data).toEqual([]);

    await owner.close();
    await other.close();
  });

  test('password field is never prefilled and stays masked', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Şifre')).toHaveAttribute('type', 'password');
    await expect(page.getByLabel('Şifre')).toHaveValue('');
    expect(PASSWORD).toBeTruthy();
  });
});
