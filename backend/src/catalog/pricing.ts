import { Prisma } from '../generated/prisma/client.js';

/**
 * Money rules of the catalog (CAT-05, docs/DATABASE.md "Fiyat"):
 * - Amounts are decimal strings with at most 2 fraction digits ("199.90");
 *   never JavaScript numbers. More digits are refused, not rounded.
 * - Stored as NUMERIC(12,2) with an ISO 4217 currency.
 * - Prices include VAT (KDV dahil). Net and VAT are derived per unit price:
 *   net = gross / (1 + rate / 100) rounded half-up to 2 digits (kuruş),
 *   vat = gross - net, so net + vat always equals gross exactly.
 */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

/** 0 ≤ amount ≤ 9 999 999 999.99 (NUMERIC(12,2)), at most 2 fraction digits. */
export const AMOUNT_PATTERN = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;

/** Currencies accepted for prices; the database only checks the ISO 4217 shape. */
export const CURRENCIES = ['TRY', 'USD', 'EUR'] as const;

/** Turkish VAT (KDV) rates in force; the database only checks 0–100. */
export const VAT_RATES = ['0', '1', '10', '20'] as const;

/** Price channel code: "list" is the list price, any other code a sales channel. */
export const LIST_CHANNEL = 'list';
export const CHANNEL_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const ROUND = Prisma.Decimal.ROUND_HALF_UP;

/** Fixed 2-digit string of a stored amount or rate ("199.9" → "199.90"). */
export const money = (value: Decimal | string): string =>
  new Prisma.Decimal(value).toFixed(2, ROUND);

/** Net (VAT-exclusive) amount and VAT of a VAT-inclusive unit price. */
export function splitVat(
  gross: Decimal | string,
  rate: Decimal | string | null,
): { net: string; vat: string } | null {
  if (rate === null) return null;
  const g = new Prisma.Decimal(gross);
  const net = g
    .div(new Prisma.Decimal(rate).div(100).plus(1))
    .toDecimalPlaces(2, ROUND);
  return { net: net.toFixed(2), vat: g.minus(net).toFixed(2) };
}
