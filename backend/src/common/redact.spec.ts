import { redact } from './redact.js';

/** OPS-01 acceptance: logs never carry personal data or secrets (automatic masking test). */
describe('redact', () => {
  it.each([
    ['Authorization: Bearer abc.def-123', 'abc.def-123'],
    ['basic Zm9vOmJhcg==', 'Zm9vOmJhcg=='],
    [
      'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl',
      'eyJhbGciOiJIUzI1NiJ9',
    ],
    ['{"password":"Correct-Horse-9"}', 'Correct-Horse-9'],
    ["password='hunter2'", 'hunter2'],
    ['şifre=Gizli123', 'Gizli123'],
    ['apiSecret: as-ct-2222', 'as-ct-2222'],
    ['{"api_key": "ak-123"}', 'ak-123'],
    ['postgresql://tm_app:S3cr3t!@localhost:5432/db', 'S3cr3t!'],
    ['user ayse.yilmaz@example.com failed', 'ayse.yilmaz'],
    ['IBAN TR33 0006 1005 1978 6457 8413 26', '6457'],
    ['tel: +90 532 123 45 67', '532 123 45 67'],
    ['tel 05321234567', '05321234567'],
    ['TCKN 10000000146', '10000000146'],
    [
      'key a3f5c7e9b1d2a3f5c7e9b1d2a3f5c7e9b1d2a3f5',
      'a3f5c7e9b1d2a3f5c7e9b1d2a3f5c7e9b1d2a3f5',
    ],
  ])('masks %s', (input, secret) => {
    const out = redact(input);
    expect(out).not.toContain(secret);
  });

  it('keeps what logs need: ids, codes, numbers, domains', () => {
    const line =
      'order 3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f tenant=7b1 status=409 code=STOCK_INSUFFICIENT took 125ms qty=12';
    expect(redact(line)).toBe(line);
    expect(redact('mail to a***@example.com')).toContain('@example.com');
    expect(redact('ayse@example.com')).toBe('a***@example.com');
  });
});
