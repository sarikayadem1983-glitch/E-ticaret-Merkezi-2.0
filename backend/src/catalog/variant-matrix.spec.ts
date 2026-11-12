import {
  cartesian,
  combinationCount,
  combinationKey,
  generatedSku,
  skuCode,
} from './variant-matrix.js';

describe('variant-matrix', () => {
  it('cartesian keeps axis order, first axis slowest', () => {
    expect(
      cartesian([
        ['K', 'M'],
        ['S', 'L'],
      ]),
    ).toEqual([
      ['K', 'S'],
      ['K', 'L'],
      ['M', 'S'],
      ['M', 'L'],
    ]);
    expect(cartesian([['a']])).toEqual([['a']]);
    expect(cartesian([])).toEqual([]);
    expect(cartesian([['a'], []])).toEqual([]);
  });

  it('combinationCount multiplies axis sizes', () => {
    expect(combinationCount([[1, 2, 3], [1, 2], [1]])).toBe(6);
    expect(combinationCount([])).toBe(0);
  });

  it('combinationKey is order independent', () => {
    const a = { attributeId: 'a', valueId: '1' };
    const b = { attributeId: 'b', valueId: '2' };
    expect(combinationKey([a, b])).toBe(combinationKey([b, a]));
    expect(combinationKey([a])).not.toBe(combinationKey([a, b]));
    expect(combinationKey([])).toBe('');
  });

  it.each([
    ['Kırmızı', 'KIRMIZI'],
    ['İnci Beyazı', 'INCI-BEYAZI'],
    ['Şeftali/Gül', 'SEFTALI-GUL'],
    ['Çok Açık Ögeğ', 'COK-ACIK-OGEG'],
    ['XL', 'XL'],
    ['  38 / 40  ', '38-40'],
    ['Crème', 'CREME'],
    ['!!!', 'X'],
    ['Çok uzun bir renk adı denemesi', 'COK-UZUN-BIR-RENK-AD'],
  ])('skuCode(%s) = %s', (value, code) => {
    expect(skuCode(value)).toBe(code);
  });

  it('generatedSku joins prefix and codes', () => {
    expect(generatedSku('TSHIRT', ['Kırmızı', 'XL'])).toBe('TSHIRT-KIRMIZI-XL');
    expect(generatedSku('P'.repeat(99), ['A']).length).toBe(100);
  });
});
