import { formatAmount, parseAmount } from './money';

describe('money', () => {
  it.each([
    ['199,90', '199.90'],
    ['199.9', '199.9'],
    ['1.234,50', '1234.50'],
    [' 0 ', '0'],
    ['10', '10'],
  ])('parses %s', (input, out) => expect(parseAmount(input)).toBe(out));

  it.each(['', '-1', '1,999', 'abc', '1e3', '01', '1,2,3'])(
    'refuses %s',
    (input) => expect(parseAmount(input)).toBeNull(),
  );

  it('formats Turkish style without floats', () => {
    expect(formatAmount('1234567.5')).toBe('1.234.567,50 ₺');
    expect(formatAmount('0.03', 'EUR')).toBe('0,03 €');
    expect(formatAmount('9999999999.99')).toBe('9.999.999.999,99 ₺');
  });
});
