import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IMPORT_COLUMN_LABEL, IMPORT_MAX_BYTES, importTemplate } from './product-import';

const backend = readFileSync(
  join(__dirname, '../../../backend/src/imports/product-csv.ts'),
  'utf8',
);

describe('product import helpers', () => {
  it('uses exactly the backend columns, in order', () => {
    const keys = [...backend.matchAll(/\{ key: '(\w+)', label:/g)].map((m) => m[1]);
    expect(Object.keys(IMPORT_COLUMN_LABEL)).toEqual(keys);
  });

  it('uses the backend size limit', () => {
    const limit = /export const MAX_BYTES = ([\d_]+);/.exec(backend)?.[1].replaceAll('_', '');
    expect(String(IMPORT_MAX_BYTES)).toBe(limit);
  });

  it('template starts with a BOM and the header', () => {
    const t = importTemplate();
    expect(t.charCodeAt(0)).toBe(0xfeff);
    expect(t.split('\r\n')[0].slice(1)).toBe('urun_adi;sku;barkod;kdv_orani;liste_fiyati;para_birimi');
  });
});
