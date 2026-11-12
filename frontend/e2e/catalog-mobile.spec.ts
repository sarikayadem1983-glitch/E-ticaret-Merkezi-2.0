import { expect, type Page, test } from '@playwright/test';
import { newAccount, PASSWORD, randomVkn } from './helpers';

/** Same-origin BFF call with the CSRF headers the app sends. */
async function bff(page: Page, method: string, path: string, data?: unknown) {
  const origin = new URL(page.url()).origin;
  const res = await page.request.fetch(`/api/bff/${path}`, {
    method,
    data,
    headers: { origin, 'x-tm-csrf': '1', 'sec-fetch-site': 'same-origin' },
  });
  expect(res.ok(), `${method} ${path}: ${res.status()}`).toBe(true);
  return res.json();
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('mobile: product form, variant generation and prices (CAT-04)', async ({ page }) => {
  const account = newAccount('catalog');
  await page.goto('/register');
  await page.getByLabel('Mağaza adı', { exact: true }).fill(`E2E Mağaza ${account.slug}`);
  await page.getByLabel('Mağaza kısa adı', { exact: true }).fill(account.slug);
  await page.getByLabel('Ad soyad', { exact: true }).fill(account.name);
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Hesap oluştur' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await bff(page, 'POST', 'companies', {
    legalName: 'Katalog Test Ltd',
    taxNumber: randomVkn(),
    taxOffice: 'Kadıköy',
    addressLine: 'Moda Cad. No: 1',
    district: 'Kadıköy',
    city: 'İstanbul',
  });
  await bff(page, 'POST', 'attributes', { name: 'Renk', values: ['Kırmızı', 'Mavi'] });
  await bff(page, 'POST', 'attributes', { name: 'Beden', values: ['S', 'M'] });

  // Menu → Ürünler
  await page.getByRole('button', { name: 'Menüyü aç' }).click();
  await page.getByRole('link', { name: 'Ürünler' }).click();
  await expect(page.getByText('Henüz ürün yok')).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  await page.getByRole('link', { name: 'Yeni ürün' }).click();
  await expect(page.getByRole('heading', { name: 'Yeni ürün' })).toBeVisible();
  await page.getByLabel('Firma*').selectOption({ label: 'Katalog Test Ltd' });
  await page.getByLabel('Ürün adı*').fill('Pamuklu Tişört');
  await page.getByLabel('KDV oranı', { exact: true }).selectOption('20');
  await page.getByLabel('SKU*').fill(`TS-${account.slug}`);
  await page.getByLabel('Liste fiyatı (KDV dahil)', { exact: true }).fill('199,90');
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByRole('button', { name: 'Ürünü kaydet' }).click();

  await expect(page.getByRole('heading', { name: 'Pamuklu Tişört' })).toBeVisible();
  await expect(page.getByText('199,90 ₺')).toBeVisible();
  await expect(page.getByText('Net 166,58 ₺ · KDV 33,32 ₺')).toBeVisible();

  await page.getByRole('button', { name: 'Eksenlerden üret' }).click();
  const dialog = page.getByRole('dialog');
  for (const v of ['Kırmızı', 'Mavi', 'S', 'M']) {
    await dialog.getByRole('button', { name: v, exact: true }).click();
  }
  await expect(dialog.getByText('4 kombinasyon')).toBeVisible();
  await dialog.getByRole('button', { name: 'Üret' }).click();
  await expect(page.getByRole('heading', { name: 'Varyantlar (5)' })).toBeVisible();
  await expect(page.getByText('PAMUKLU-TISORT-KIRMIZI-S')).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);

  // A channel price on the first generated variant.
  const row = page.getByRole('listitem').filter({ hasText: 'PAMUKLU-TISORT-MAVI-M' });
  await row.getByLabel('Kanal', { exact: true }).fill('trendyol');
  await row.getByLabel('Tutar (KDV dahil)', { exact: true }).fill('219,90');
  await row.getByRole('button', { name: 'Fiyatı yaz' }).click();
  await expect(row.getByText('219,90 ₺')).toBeVisible();

  await page.goto('/products');
  await expect(page.getByText('5 varyant · 199,90 ₺')).toBeVisible();
});
