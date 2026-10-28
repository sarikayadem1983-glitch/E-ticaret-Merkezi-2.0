import { type Page, expect } from '@playwright/test';
import { Redis } from 'ioredis';

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
