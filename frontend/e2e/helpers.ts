import { type Page, expect } from '@playwright/test';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';

export const PASSWORD = 'E2e-Sifre-2026!';

export interface Account {
  email: string;
  slug: string;
  name: string;
}

export function newAccount(label: string): Account {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  return {
    email: `e2e-${label}-${id}@example.com`,
    slug: `e2e-${label}-${id}`,
    name: 'Ayşe Yılmaz',
  };
}

/**
 * Every test signs up from localhost and the backend allows 5 sign-ups per IP
 * per hour, so counters are cleared first. Test environment only.
 */
export async function resetRateLimits() {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  try {
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

export async function register(page: Page, account: Account) {
  await resetRateLimits();
  await page.goto('/register');
  await page.getByLabel('Mağaza adı').fill(`E2E Mağaza ${account.slug}`);
  await page.getByLabel('Mağaza kısa adı').fill(account.slug);
  await page.getByLabel('Ad soyad').fill(account.name);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Hesap oluştur' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Şifre').fill(PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
}

/** VKN with a valid check digit for a random 9-digit prefix. */
export function randomVkn(): string {
  const prefix = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const d = prefix.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (d[i] + 9 - i) % 10;
    sum += t === 9 ? 9 : (t * 2 ** (9 - i)) % 9;
  }
  return prefix + String((10 - (sum % 10)) % 10);
}

/**
 * Opens a dropdown and returns its item. A click that lands before React has
 * hydrated the trigger is lost, so retry until the menu is actually open.
 */
export async function openMenu(page: Page, trigger: string, item: string | RegExp) {
  const menuItem = page.getByRole('menuitem', { name: item });
  await expect(async () => {
    if (!(await menuItem.isVisible())) {
      await page.getByRole('button', { name: trigger }).click();
    }
    await expect(menuItem).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return menuItem;
}

/** Simulates idle/absolute expiry of one test session by removing only its Redis entry. */
export async function expireSession(sid: string) {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  try {
    await redis.del(`bff:sess:${createHash('sha256').update(sid).digest('hex')}`);
  } finally {
    redis.disconnect();
  }
}

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/**
 * Returns the newest invitation link sent to `email` from Mailpit (dev/test
 * SMTP only). Only the `/invite/<token>` path is kept so the link opens on the
 * app under test whatever origin the backend put in the mail.
 */
export async function readInviteLinkFromMailpit(email: string): Promise<string> {
  const query = encodeURIComponent(`to:"${email}"`);
  let path = '';
  await expect(async () => {
    const list = (await (
      await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=1`)
    ).json()) as { messages?: { ID: string }[] };
    const id = list.messages?.[0]?.ID;
    expect(id, `${email} için davet e-postası`).toBeTruthy();
    const message = (await (
      await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)
    ).json()) as { Text?: string; HTML?: string };
    const match = /\/invite\/([A-Za-z0-9_-]+)/.exec(
      `${message.Text ?? ''} ${message.HTML ?? ''}`,
    );
    expect(match, 'davet bağlantısı').not.toBeNull();
    path = `/invite/${match![1]}`;
  }).toPass({ timeout: 20_000 });
  return path;
}

/** Creates an active company through the UI and returns its id. */
export async function createCompany(page: Page, legalName: string): Promise<string> {
  await page.goto('/companies/new');
  await page.getByLabel('Ticari unvan').fill(legalName);
  await page.getByLabel('VKN / TCKN').fill(randomVkn());
  await page.getByLabel('Vergi dairesi').fill('Kadıköy');
  await page.locator('#addressLine').fill('Moda Caddesi No: 12');
  await page.getByLabel('İlçe').fill('Kadıköy');
  await page.locator('#city').fill('İstanbul');
  await page.getByRole('button', { name: 'Firmayı kaydet' }).click();
  await expect(page.getByRole('heading', { name: legalName })).toBeVisible();
  const id = /\/companies\/([^/?#]+)$/.exec(page.url())?.[1];
  expect(id).toBeTruthy();
  return id!;
}

/** Origin of the app under test (same as `baseURL` in playwright.config.ts). */
export const APP_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
