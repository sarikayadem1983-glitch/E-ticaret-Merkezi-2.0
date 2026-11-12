/** Pure helpers for variant attributes and generation (CAT-03). */

export interface AxisValue {
  attributeId: string;
  valueId: string;
}

export const MAX_COMBINATIONS = 100;

/** Cartesian product of the axes, first axis varying slowest. Empty axes yield nothing. */
export function cartesian<T>(axes: T[][]): T[][] {
  if (axes.length === 0) return [];
  return axes.reduce<T[][]>(
    (acc, axis) => acc.flatMap((combo) => axis.map((v) => [...combo, v])),
    [[]],
  );
}

/** Number of combinations without building them. */
export function combinationCount(axes: unknown[][]): number {
  return axes.reduce((n, axis) => n * axis.length, axes.length ? 1 : 0);
}

/**
 * Stable key of a variant's attribute set: order-independent, so two variants
 * with the same attribute/value pairs get the same key. No attributes → ''.
 */
export function combinationKey(values: AxisValue[]): string {
  return values
    .map((v) => `${v.attributeId}=${v.valueId}`)
    .sort()
    .join('&');
}

const TR_ASCII: Record<string, string> = {
  ç: 'C',
  Ç: 'C',
  ğ: 'G',
  Ğ: 'G',
  ı: 'I',
  İ: 'I',
  i: 'I',
  ö: 'O',
  Ö: 'O',
  ş: 'S',
  Ş: 'S',
  ü: 'U',
  Ü: 'U',
};

/**
 * SKU code of a value: Turkish letters mapped to ASCII without the locale
 * (so "i"/"İ"/"ı" all become "I"), uppercase, any other non-alphanumeric run
 * becomes one "-", trimmed of "-", at most 20 characters. Empty → "X".
 */
export function skuCode(value: string): string {
  const ascii = value
    .replace(/[çÇğĞıİiöÖşŞüÜ]/g, (c) => TR_ASCII[c] ?? c)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  const code = ascii
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
    .replace(/-+$/g, '');
  return code || 'X';
}

/** SKU of a generated variant: prefix plus the code of each value, axis order kept. */
export function generatedSku(prefix: string, values: string[]): string {
  return [prefix, ...values.map(skuCode)].join('-').slice(0, 100);
}
