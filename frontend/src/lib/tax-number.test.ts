import { isValidTaxNumber, isValidTckn, isValidVkn } from './tax-number';

describe('tax number (frontend copy)', () => {
  it('matches the backend rules', () => {
    expect(isValidTckn('10000000146')).toBe(true);
    expect(isValidTckn('10000000147')).toBe(false);
    const valid = '0123456789'.split('').filter((d) => isValidVkn(`123456789${d}`));
    expect(valid).toHaveLength(1);
    expect(isValidTaxNumber('12345')).toBe(false);
  });
});
