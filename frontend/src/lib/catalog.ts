import type { ProductStatus, Variant } from './types';

export const STATUS_LABEL: Record<ProductStatus, string> = {
  draft: 'Taslak',
  active: 'Aktif',
  archived: 'Arşiv',
};

export const MAX_COMBINATIONS = 100;

/** Number of variants an axis selection would produce (0 with no axis). */
export function combinationCount(axes: { valueIds: string[] }[]): number {
  const used = axes.filter((a) => a.valueIds.length > 0);
  return used.length === 0
    ? 0
    : used.reduce((n, a) => n * a.valueIds.length, 1);
}

/** "Renk: Kırmızı · Beden: XL" for a variant; "" when it has no attributes. */
export function variantLabel(v: Pick<Variant, 'attributes'>): string {
  return v.attributes.map((a) => `${a.attributeName}: ${a.value}`).join(' · ');
}

/** SKU prefix suggestion from a product name: ASCII, uppercase, dashes. */
export function skuPrefix(name: string): string {
  const map: Record<string, string> = {
    ç: 'C', ğ: 'G', ı: 'I', i: 'I', ö: 'O', ş: 'S', ü: 'U',
    Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U',
  };
  return (
    name
      .replace(/[çğıiöşüÇĞİÖŞÜ]/g, (c) => map[c] ?? c)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
      .replace(/-+$/g, '') || 'URUN'
  );
}
