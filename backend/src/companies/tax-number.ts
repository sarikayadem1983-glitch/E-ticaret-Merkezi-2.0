const digits = (value: string) => value.split('').map(Number);

/** Turkish tax identification number (Vergi Kimlik No): 10 digits, last one is a check digit. */
export function isValidVkn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const d = digits(value);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (d[i] + 9 - i) % 10;
    sum += t === 9 ? 9 : (t * 2 ** (9 - i)) % 9;
  }
  return (10 - (sum % 10)) % 10 === d[9];
}

/** Turkish national identity number (TC Kimlik No): 11 digits, two check digits, no leading zero. */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = digits(value);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d[9] === d10 && d[10] === d11;
}

export function isValidTaxNumber(value: string): boolean {
  return value.length === 10 ? isValidVkn(value) : isValidTckn(value);
}
