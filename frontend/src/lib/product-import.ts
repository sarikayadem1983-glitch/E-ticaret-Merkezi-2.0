/**
 * Product import (IMP-01) in the UI. Column keys mirror backend/src/imports/product-csv.ts
 * (product-import.test.ts keeps them identical); the backend validates every row again.
 */
export const IMPORT_COLUMN_LABEL = {
  urun_adi: 'Ürün adı (zorunlu)',
  sku: 'SKU (zorunlu, benzersiz)',
  barkod: 'Barkod',
  kdv_orani: 'KDV oranı: 0, 1, 10 veya 20',
  liste_fiyati: 'Liste fiyatı, KDV dahil (ör. 199,90)',
  para_birimi: 'Para birimi: TRY, USD, EUR (boşsa TRY)',
} as const;

/** Same limit as the backend (under the 100 KB request body limit). */
export const IMPORT_MAX_BYTES = 95_000;

/** UTF-8 BOM + ';' so Excel (Turkish) opens it with the right columns and characters. */
export function importTemplate(): string {
  const header = Object.keys(IMPORT_COLUMN_LABEL).join(';');
  return (
    `﻿${header}\r\n` +
    'Pamuklu Tişört;TS-001-S;8690000000017;20;249,90;TRY\r\n' +
    'Pamuklu Tişört;TS-001-M;;20;249,90;TRY\r\n'
  );
}
