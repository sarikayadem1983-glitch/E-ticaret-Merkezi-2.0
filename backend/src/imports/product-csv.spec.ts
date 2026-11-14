import {
  isFormula,
  parseAmount,
  parseCsv,
  template,
  validate,
} from './product-csv.js';

const H = 'urun_adi;sku;barkod;kdv_orani;liste_fiyati;para_birimi';

describe('product import CSV', () => {
  it('the template parses cleanly and has a BOM for Excel', () => {
    const t = template();
    expect(t.startsWith('﻿')).toBe(true);
    const r = validate(t);
    expect(r.errors).toEqual([]);
    expect(r.products).toEqual([
      {
        name: 'Pamuklu Tişört',
        vatRate: '20',
        variants: [
          {
            row: 2,
            sku: 'TS-001-S',
            barcode: '8690000000017',
            price: { amount: '249.90', currency: 'TRY' },
          },
          {
            row: 3,
            sku: 'TS-001-M',
            barcode: null,
            price: { amount: '249.90', currency: 'TRY' },
          },
        ],
      },
    ]);
  });

  it('parses quotes, doubled quotes, both separators and CRLF', () => {
    expect(parseCsv('a;b\r\n"x;y";"say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x;y', 'say "hi"'],
    ]);
    expect(parseCsv('a,b\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('amounts accept Turkish and dotted forms, never more than 2 decimals', () => {
    expect(parseAmount('1.234,50')).toBe('1234.50');
    expect(parseAmount('199.9')).toBe('199.9');
    expect(parseAmount('1,005')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('rejects formula cells (CSV injection) in any column', () => {
    for (const v of ['=1+1', '+90', '-2', '@SUM(A1)', '\tx'])
      expect(isFormula(v)).toBe(true);
    expect(isFormula('Tişört')).toBe(false);
    const r = validate(
      `${H}\n=HYPERLINK("http://x");SKU1;;;;\nÜrün;@SKU;;;;\n`,
    );
    expect(r.errors.map((e) => [e.row, e.column])).toEqual([
      [2, 'urun_adi'],
      [3, 'sku'],
    ]);
    expect(r.products).toEqual([]);
  });

  it('reports every bad cell with its row and column', () => {
    const r = validate(
      [
        H,
        ';A1;;20;10;TRY', // no name
        'X;;;20;10;TRY', // no sku
        'Y;Y1;;18;10;TRY', // bad VAT
        'Z;Z1;;20;10,001;TRY', // bad price
        'W;W1;;20;10;GBP', // bad currency
        'V;A1x;;;;', // ok
        'V;a1X;;;;', // duplicate SKU (case-insensitive)
      ].join('\n'),
    );
    expect(r.errors.map((e) => [e.row, e.column])).toEqual([
      [2, 'urun_adi'],
      [3, 'sku'],
      [4, 'kdv_orani'],
      [5, 'liste_fiyati'],
      [6, 'para_birimi'],
      [8, 'sku'],
    ]);
    expect(r.errors[5].message).toContain('satır 7');
  });

  it('groups rows by product name and checks product-level columns agree', () => {
    const r = validate(
      [H, 'Kupa;K1;;20;;', 'kupa;K2;;20;;', 'KUPA;K3;;10;;'].join('\n'),
    );
    expect(r.products).toHaveLength(1);
    expect(r.products[0].variants.map((v) => v.sku)).toEqual(['K1', 'K2']);
    expect(r.errors).toEqual([
      {
        row: 4,
        column: 'kdv_orani',
        message: expect.stringContaining('satır 2'),
      },
    ]);
  });

  it('header problems and size limits stop early', () => {
    expect(validate('').errors[0].message).toBe('Dosya boş');
    expect(validate('ad;kod\nx;y').errors.map((e) => e.column)).toEqual([
      'urun_adi',
      'sku',
      null,
    ]);
    const many = [
      H,
      ...Array.from({ length: 1001 }, (_, i) => `P${i};S${i};;;;`),
    ].join('\n');
    expect(validate(many).errors[0].message).toContain('1000');
  });
});
