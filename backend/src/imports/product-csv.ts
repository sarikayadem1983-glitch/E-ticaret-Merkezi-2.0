/**
 * Product import CSV (IMP-01): template, parser and row validation. Pure functions, no
 * database: the service adds the checks that need it (SKUs already taken).
 *
 * One row = one variant. Rows with the same product name (case-insensitive, trimmed)
 * become variants of one product; product-level columns (KDV) must agree between them.
 */

export const COLUMNS = [
  { key: 'urun_adi', label: 'Ürün adı (zorunlu)' },
  { key: 'sku', label: 'SKU (zorunlu, benzersiz)' },
  { key: 'barkod', label: 'Barkod' },
  { key: 'kdv_orani', label: 'KDV oranı: 0, 1, 10 veya 20' },
  { key: 'liste_fiyati', label: 'Liste fiyatı, KDV dahil (ör. 199,90)' },
  { key: 'para_birimi', label: 'Para birimi: TRY, USD, EUR (boşsa TRY)' },
] as const;

export type ColumnKey = (typeof COLUMNS)[number]['key'];
export const MAX_ROWS = 1000;
/** Under the global 100 KB JSON body limit (BODY_LIMIT), which is not raised for imports. */
export const MAX_BYTES = 95_000;
const VAT = ['0', '1', '10', '20'];
const CURRENCIES = ['TRY', 'USD', 'EUR'];
const AMOUNT = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;

export interface RowError {
  /** 1-based line in the file (header = 1). */
  row: number;
  column: ColumnKey | null;
  message: string;
}

export interface ParsedVariant {
  row: number;
  sku: string;
  barcode: string | null;
  price: { amount: string; currency: string } | null;
}

export interface ParsedProduct {
  name: string;
  vatRate: string | null;
  variants: ParsedVariant[];
}

/** UTF-8 BOM so Excel opens Turkish characters correctly; ';' is Excel's TR separator. */
export function template(): string {
  const header = COLUMNS.map((c) => c.key).join(';');
  const example = [
    'Pamuklu Tişört',
    'TS-001-S',
    '8690000000017',
    '20',
    '249,90',
    'TRY',
  ].join(';');
  const example2 = [
    'Pamuklu Tişört',
    'TS-001-M',
    '',
    '20',
    '249,90',
    'TRY',
  ].join(';');
  return `﻿${header}\r\n${example}\r\n${example2}\r\n`;
}

/**
 * RFC 4180 style parser with auto-detected separator (';' or ',' from the header line).
 * Quotes: "a;b" and doubled "" inside. Returns rows of raw cell strings.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Cells that a spreadsheet would run as a formula (CSV injection). Leading '-' or '+' is
 * only allowed for plain numbers ("-5", "+90 ..." is not accepted either: no column needs
 * a sign). Also tab / carriage return at the start.
 */
export function isFormula(value: string): boolean {
  return /^[=+\-@\t\r]/.test(value);
}

/** "1.234,50" or "1234.5" → "1234.50"-style string; null when invalid. */
export function parseAmount(input: string): string | null {
  let s = input.trim().replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return AMOUNT.test(s) ? s : null;
}

export function validate(input: string): {
  products: ParsedProduct[];
  errors: RowError[];
  rows: number;
} {
  const errors: RowError[] = [];
  const all = parseCsv(input);
  if (all.length === 0) {
    return {
      products: [],
      errors: [{ row: 1, column: null, message: 'Dosya boş' }],
      rows: 0,
    };
  }
  const header = all[0].map((h) => h.trim().toLowerCase());
  const index = new Map<ColumnKey, number>();
  for (const c of COLUMNS) {
    const i = header.indexOf(c.key);
    if (i >= 0) index.set(c.key, i);
  }
  for (const required of ['urun_adi', 'sku'] as const) {
    if (!index.has(required)) {
      errors.push({
        row: 1,
        column: required,
        message: `"${required}" kolonu yok; şablonu kullanın`,
      });
    }
  }
  const unknown = header.filter((h) => h && !COLUMNS.some((c) => c.key === h));
  if (unknown.length) {
    errors.push({
      row: 1,
      column: null,
      message: `Bilinmeyen kolon: ${unknown.join(', ')}`,
    });
  }
  if (errors.length) return { products: [], errors, rows: all.length - 1 };

  const data = all.slice(1);
  if (data.length > MAX_ROWS) {
    return {
      products: [],
      errors: [
        {
          row: 1,
          column: null,
          message: `En çok ${MAX_ROWS} satır içe aktarılabilir (dosyada ${data.length})`,
        },
      ],
      rows: data.length,
    };
  }

  const products = new Map<string, ParsedProduct & { vatRow: number }>();
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  data.forEach((cells, i) => {
    const row = i + 2;
    const get = (k: ColumnKey) =>
      index.has(k) ? (cells[index.get(k)!] ?? '').trim() : '';
    const err = (column: ColumnKey | null, message: string) =>
      errors.push({ row, column, message });
    let ok = true;
    for (const c of COLUMNS) {
      const raw = index.has(c.key) ? (cells[index.get(c.key)!] ?? '') : '';
      if (isFormula(raw)) {
        err(
          c.key,
          'Hücre formül olarak yorumlanabilir (=, +, -, @ ile başlıyor); güvenlik için reddedildi',
        );
        ok = false;
      }
    }
    if (!ok) return;

    const name = get('urun_adi');
    const sku = get('sku');
    const barcode = get('barkod') || null;
    const vat = get('kdv_orani') || null;
    const priceRaw = get('liste_fiyati');
    const currency = (get('para_birimi') || 'TRY').toUpperCase();

    if (!name) err('urun_adi', 'Ürün adı zorunlu');
    else if (name.length > 250) err('urun_adi', 'Ürün adı en çok 250 karakter');
    if (!sku) err('sku', 'SKU zorunlu');
    else if (sku.length > 100) err('sku', 'SKU en çok 100 karakter');
    else if (seenSku.has(sku.toLowerCase()))
      err(
        'sku',
        `SKU dosyada tekrar ediyor (satır ${seenSku.get(sku.toLowerCase())})`,
      );
    if (barcode && barcode.length > 50)
      err('barkod', 'Barkod en çok 50 karakter');
    else if (barcode && seenBarcode.has(barcode))
      err(
        'barkod',
        `Barkod dosyada tekrar ediyor (satır ${seenBarcode.get(barcode)})`,
      );
    if (vat !== null && !VAT.includes(vat))
      err('kdv_orani', 'KDV oranı 0, 1, 10 veya 20 olmalı');
    let price: ParsedVariant['price'] = null;
    if (priceRaw) {
      const amount = parseAmount(priceRaw);
      if (amount === null)
        err('liste_fiyati', 'Fiyat geçersiz (ör. 199,90; en çok 2 ondalık)');
      else if (!CURRENCIES.includes(currency))
        err('para_birimi', 'Para birimi TRY, USD veya EUR olmalı');
      else price = { amount, currency };
    } else if (get('para_birimi') && !CURRENCIES.includes(currency)) {
      err('para_birimi', 'Para birimi TRY, USD veya EUR olmalı');
    }
    if (sku)
      seenSku.set(sku.toLowerCase(), seenSku.get(sku.toLowerCase()) ?? row);
    if (barcode) seenBarcode.set(barcode, seenBarcode.get(barcode) ?? row);
    if (errors.some((e) => e.row === row) || !name || !sku) return;

    const key = name.toLocaleLowerCase('tr-TR');
    const product = products.get(key);
    if (!product) {
      products.set(key, {
        name,
        vatRate: vat,
        vatRow: row,
        variants: [{ row, sku, barcode, price }],
      });
    } else {
      if (product.vatRate !== vat) {
        err(
          'kdv_orani',
          `Aynı ürünün KDV oranı farklı (satır ${product.vatRow}: ${product.vatRate ?? 'boş'})`,
        );
        return;
      }
      if (product.variants.length >= 100) {
        err('urun_adi', 'Bir ürün en çok 100 varyant içerebilir');
        return;
      }
      product.variants.push({ row, sku, barcode, price });
    }
  });

  return {
    products: [...products.values()].map(({ vatRow: _v, ...p }) => p),
    errors: errors.sort((a, b) => a.row - b.row),
    rows: data.length,
  };
}
