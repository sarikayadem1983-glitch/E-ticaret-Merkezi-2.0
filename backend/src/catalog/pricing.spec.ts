import { AMOUNT_PATTERN, money, splitVat } from './pricing.js';

describe('pricing', () => {
  it.each(['0', '0.5', '0.05', '199.90', '9999999999.99', '10'])(
    'accepts %s',
    (v) => expect(AMOUNT_PATTERN.test(v)).toBe(true),
  );

  it.each([
    '',
    '-1',
    '1.999',
    '01',
    '1e3',
    '10000000000',
    '1,50',
    ' 1',
    '.5',
    '1.',
  ])('refuses %s', (v) => expect(AMOUNT_PATTERN.test(v)).toBe(false));

  it('formats with two digits', () => {
    expect(money('199.9')).toBe('199.90');
    expect(money('0')).toBe('0.00');
  });

  it('splits VAT half-up at kuruş and keeps net + vat = gross', () => {
    expect(splitVat('199.90', '20')).toEqual({ net: '166.58', vat: '33.32' });
    expect(splitVat('100.00', '10')).toEqual({ net: '90.91', vat: '9.09' });
    expect(splitVat('100.00', '0')).toEqual({ net: '100.00', vat: '0.00' });
    expect(splitVat('1.01', '1')).toEqual({ net: '1.00', vat: '0.01' });
    // 0.03 / 1.2 = 0.025 exactly: half-up gives 0.03, not banker's 0.02.
    expect(splitVat('0.03', '20')).toEqual({ net: '0.03', vat: '0.00' });
    expect(splitVat('10', null)).toBeNull();
  });

  it('is exact where floats are not', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004.
    expect(splitVat('0.30', '0')).toEqual({ net: '0.30', vat: '0.00' });
    expect(splitVat('9999999999.99', '20')).toEqual({
      net: '8333333333.33',
      vat: '1666666666.66',
    });
  });
});
