import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { createCompany, newAccount, register } from './helpers';

/** Solid-colour PNG without an image library. */
function png(size: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    let crc = 0xffffffff;
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const end = Buffer.alloc(4);
    end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, end]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from(rgb))]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Needs object storage (STORAGE_*; local MinIO). */
test('mobile: product images upload, show, reorder, bind and delete (IMG-01)', async ({ page }) => {
  const account = newAccount('images');
  await register(page, account);
  const companyId = await createCompany(page, `Görsel Firması ${account.slug}`);
  const origin = new URL(page.url()).origin;
  const res = await page.request.post('/api/bff/products', {
    headers: { origin, 'x-tm-csrf': '1' },
    data: { companyId, name: 'Görselli Ürün', variants: [{ sku: `IMG-${account.slug}` }] },
  });
  expect(res.status()).toBe(201);
  const { data } = (await res.json()) as { data: { id: string } };
  await page.goto(`/products/${data.id}`);

  const section = page.getByRole('region', { name: 'Görseller' });
  await expect(section.getByText('Henüz görsel yok')).toBeVisible();
  await section.getByLabel('Görsel dosyası seç').setInputFiles([
    { name: 'bir.png', mimeType: 'image/png', buffer: png(120, [224, 112, 32]) },
    { name: 'iki.png', mimeType: 'image/png', buffer: png(140, [18, 52, 86]) },
    { name: 'sahte.png', mimeType: 'image/png', buffer: Buffer.from('<svg></svg> degil bir png') },
  ]);
  await expect(page.getByText('sahte.png: Yalnızca JPEG, PNG ve WebP')).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Görseller (2)' })).toBeVisible();

  // The browser really loaded the signed URL (CSP allows the storage origin).
  const first = section.getByRole('img').first();
  await expect.poll(() => first.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(120);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await section.getByRole('button', { name: 'Görsel 1 sona al' }).click();
  await expect.poll(() => first.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(140);

  await section.getByLabel('Görsel 1 varyantı').selectOption({ label: `IMG-${account.slug}` });
  await page.reload();
  await expect(section.getByLabel('Görsel 1 varyantı').locator('option:checked')).toHaveText(
    `IMG-${account.slug}`,
  );

  await section.getByRole('button', { name: 'Görsel 1 sil' }).click();
  await section.getByRole('button', { name: 'Sil', exact: true }).click();
  await expect(section.getByRole('heading', { name: 'Görseller (1)' })).toBeVisible();
});
