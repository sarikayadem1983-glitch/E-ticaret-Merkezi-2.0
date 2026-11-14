import { csvCell, toCsv, trAmount } from './csv-writer.js';
import { validate } from './product-csv.js';

describe('CSV writer (IMP-04)', () => {
  it('neutralises formula cells (CSV injection)', () => {
    for (const v of ['=HYPERLINK("x")', '+90', '-5', '@SUM(A1)', '\tx']) {
      expect(csvCell(v).replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('Tişört')).toBe('Tişört');
  });

  it('quotes separators, quotes and line breaks', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('x\ny')).toBe('"x\ny"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12)).toBe('12');
  });

  it('round-trips through the import parser (re-importable export)', () => {
    const csv = toCsv(
      ['urun_adi', 'sku', 'barkod', 'kdv_orani', 'liste_fiyati', 'para_birimi'],
      [
        ['Kupa; büyük', 'K-1', null, '20', trAmount('149.90'), 'TRY'],
        [
          'Kupa; büyük',
          'K-2',
          '8690000000017',
          '20',
          trAmount('149.90'),
          'TRY',
        ],
      ],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const r = validate(csv);
    expect(r.errors).toEqual([]);
    expect(r.products).toHaveLength(1);
    expect(r.products[0].name).toBe('Kupa; büyük');
    expect(r.products[0].variants.map((v) => v.price?.amount)).toEqual([
      '149.90',
      '149.90',
    ]);
  });
});
