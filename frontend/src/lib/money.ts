/**
 * Money in the UI (CAT-05 rules): amounts stay decimal strings end to end.
 * The user may type a comma ("199,90"); the API gets "199.90". Nothing is
 * converted to a JavaScript number, so no float rounding can happen.
 */

const AMOUNT = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;

export const CURRENCIES = ['TRY', 'USD', 'EUR'] as const;
export const VAT_RATES = ['0', '1', '10', '20'] as const;
export const LIST_CHANNEL = 'list';
export const CHANNEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "1.234,50" or "1234.5" → "1234.50"-style API string; null when invalid. */
export function parseAmount(input: string): string | null {
  let s = input.trim().replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!AMOUNT.test(s)) return null;
  return s;
}

const SYMBOL: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€' };

/** "1234.5" + TRY → "1.234,50 ₺" by string manipulation (no Number()). */
export function formatAmount(amount: string, currency = 'TRY'): string {
  const [int, frac = ''] = amount.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped},${(frac + '00').slice(0, 2)} ${SYMBOL[currency] ?? currency}`;
}

export function channelLabel(channel: string): string {
  return channel === LIST_CHANNEL ? 'Liste fiyatı' : channel;
}
