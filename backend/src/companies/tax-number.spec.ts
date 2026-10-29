import { isValidTaxNumber, isValidTckn, isValidVkn } from './tax-number.js';

describe('isValidVkn', () => {
  it.each(['1234567890', '0000000000', '1111111110', '9999999990'])(
    'checks the check digit of %s against the official algorithm',
    (vkn) => {
      // Exactly one final digit is valid for every 9-digit prefix.
      const valid = '0123456789'
        .split('')
        .filter((d) => isValidVkn(vkn.slice(0, 9) + d));
      expect(valid).toHaveLength(1);
    },
  );

  it('rejects wrong length and non-digits', () => {
    expect(isValidVkn('123456789')).toBe(false);
    expect(isValidVkn('12345678901')).toBe(false);
    expect(isValidVkn('12345a7890')).toBe(false);
  });
});

describe('isValidTckn', () => {
  it('accepts a known valid TCKN', () => {
    expect(isValidTckn('10000000146')).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidTckn('10000000147')).toBe(false);
    expect(isValidTckn('10000000156')).toBe(false);
  });

  it('rejects a leading zero and wrong length', () => {
    expect(isValidTckn('00000000146')).toBe(false);
    expect(isValidTckn('1000000014')).toBe(false);
  });
});

describe('isValidTaxNumber', () => {
  it('picks the algorithm by length', () => {
    expect(isValidTaxNumber('10000000146')).toBe(true);
    expect(isValidTaxNumber('1000000014')).toBe(false);
  });
});
