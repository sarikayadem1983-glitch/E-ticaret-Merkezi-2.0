import { combinationCount, skuPrefix, variantLabel } from './catalog';

describe('catalog helpers', () => {
  it('counts combinations of the selected axes', () => {
    expect(combinationCount([])).toBe(0);
    expect(combinationCount([{ valueIds: ['a', 'b'] }, { valueIds: ['x', 'y', 'z'] }])).toBe(6);
    expect(combinationCount([{ valueIds: ['a'] }, { valueIds: [] }])).toBe(1);
  });

  it('labels a variant by its attributes', () => {
    expect(
      variantLabel({
        attributes: [
          { attributeId: '1', attributeName: 'Beden', valueId: 'a', value: 'XL' },
          { attributeId: '2', attributeName: 'Renk', valueId: 'b', value: 'Kırmızı' },
        ],
      }),
    ).toBe('Beden: XL · Renk: Kırmızı');
    expect(variantLabel({ attributes: [] })).toBe('');
  });

  it('suggests an ASCII SKU prefix', () => {
    expect(skuPrefix('Pamuklu Tişört İnce')).toBe('PAMUKLU-TISORT-INCE');
    expect(skuPrefix('!!!')).toBe('URUN');
  });
});
