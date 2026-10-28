import { Prisma } from '../generated/prisma/client.js';
import { diff, MAX_JSON_BYTES, REDACTED, sanitize } from './audit.sanitizer.js';

describe('sanitize', () => {
  it.each([
    'password',
    'passwordHash',
    'newPassword',
    'refreshToken',
    'accessToken',
    'tokenHash',
    'clientSecret',
    'apiKey',
    'api_key',
    'Authorization',
    'cookie',
    'sessionId',
    'credentials',
    'privateKey',
    'cardNumber',
    'cvv',
    'iban',
    'otp',
  ])('redacts the %s key', (key) => {
    expect(sanitize({ [key]: 'gizli', name: 'Ali' })).toEqual({
      [key]: REDACTED,
      name: 'Ali',
    });
  });

  it('redacts nested and array values', () => {
    expect(
      sanitize({
        user: { profile: { password: 'x' } },
        list: [{ token: 'y' }],
      }),
    ).toEqual({
      user: { profile: { password: REDACTED } },
      list: [{ token: REDACTED }],
    });
  });

  it('redacts credential-looking values under innocent keys', () => {
    expect(
      sanitize({
        note: 'Bearer abc.def',
        jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
        h: '$argon2id$v=19$m=19456$abc',
      }),
    ).toEqual({ note: REDACTED, jwt: REDACTED, h: REDACTED });
  });

  it('keeps ordinary values', () => {
    expect(
      sanitize({ name: 'Mağaza', count: 3, active: true, none: null }),
    ).toEqual({
      name: 'Mağaza',
      count: 3,
      active: true,
      none: null,
    });
  });

  it('converts non-JSON types', () => {
    expect(
      sanitize({
        at: new Date('2026-01-02T03:04:05.000Z'),
        big: 10n,
        price: new Prisma.Decimal('12.50'),
        bin: Buffer.from('x'),
        fn: () => 1,
        undef: undefined,
      }),
    ).toEqual({
      at: '2026-01-02T03:04:05.000Z',
      big: '10',
      price: '12.5',
      bin: '[BINARY]',
    });
  });

  it('survives circular references', () => {
    const obj: Record<string, unknown> = { name: 'a' };
    obj.self = obj;
    expect(sanitize(obj)).toEqual({ name: 'a', self: '[CIRCULAR]' });
  });

  it('bounds depth, arrays and strings', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(JSON.stringify(sanitize(deep))).toContain('[TRUNCATED]');
    const arr = sanitize(Array.from({ length: 60 }, (_, i) => i)) as unknown[];
    expect(arr).toHaveLength(51);
    expect((sanitize('x'.repeat(2000)) as string).length).toBe(1001);
  });

  it('replaces oversized payloads with a marker', () => {
    const big = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, 'x'.repeat(900)]),
    );
    expect(sanitize(big)).toMatchObject({ _truncated: true });
    expect(Buffer.byteLength(JSON.stringify(sanitize(big)))).toBeLessThan(
      MAX_JSON_BYTES,
    );
  });

  it('returns undefined for nothing to store', () => {
    expect(sanitize(undefined)).toBeUndefined();
  });
});

describe('diff', () => {
  it('keeps only changed fields and ignores updatedAt', () => {
    expect(
      diff(
        { name: 'Eski', city: 'İzmir', updatedAt: new Date(1) },
        { name: 'Yeni', city: 'İzmir', updatedAt: new Date(2) },
      ),
    ).toEqual({ before: { name: 'Eski' }, after: { name: 'Yeni' } });
  });

  it('includes added and removed keys', () => {
    expect(diff({ a: 1 }, { b: 2 })).toEqual({
      before: { a: 1 },
      after: { b: 2 },
    });
  });

  it('treats equal dates and decimals as unchanged', () => {
    expect(
      diff(
        { at: new Date(5), price: new Prisma.Decimal('1.0') },
        { at: new Date(5), price: new Prisma.Decimal('1') },
      ),
    ).toEqual({ before: {}, after: {} });
  });
});
