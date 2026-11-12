import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CredentialCipher,
  CredentialCipherConfigError,
  CredentialDecryptError,
  maskSecret,
  parseCipherConfig,
} from './credential-cipher.js';

const k = () => randomBytes(32).toString('base64');
const K1 = k();
const K2 = k();
const ID = { tenantId: 't-1', accountId: 'a-1', channel: 'trendyol' };
const CREDS = {
  supplierId: '123456',
  apiKey: 'key-abcdef-1234',
  apiSecret: 'sec-xyz-9876',
};

function cipher(keks: string, active: string) {
  const config = parseCipherConfig({
    CHANNEL_KEKS: keks,
    CHANNEL_KEK_ACTIVE: active,
  });
  if (!config) throw new Error('no config');
  return new CredentialCipher(config);
}

describe('parseCipherConfig', () => {
  it('returns null when no keys are configured', () => {
    expect(parseCipherConfig({})).toBeNull();
  });

  it.each([
    [{ CHANNEL_KEK_ACTIVE: 'k1' }, 'boş'],
    [{ CHANNEL_KEKS: `k1:${K1}` }, 'CHANNEL_KEK_ACTIVE'],
    [
      { CHANNEL_KEKS: `k1:${K1}`, CHANNEL_KEK_ACTIVE: 'k2' },
      'CHANNEL_KEK_ACTIVE',
    ],
    [{ CHANNEL_KEKS: `K1:${K1}`, CHANNEL_KEK_ACTIVE: 'K1' }, 'kimliği'],
    [
      { CHANNEL_KEKS: `k1:${K1},k1:${K2}`, CHANNEL_KEK_ACTIVE: 'k1' },
      'iki kez',
    ],
    [{ CHANNEL_KEKS: 'k1:c2hvcnQ=', CHANNEL_KEK_ACTIVE: 'k1' }, '32 bayt'],
    [
      {
        CHANNEL_KEKS: `k1:${Buffer.alloc(32).toString('base64')}`,
        CHANNEL_KEK_ACTIVE: 'k1',
      },
      'zayıf',
    ],
  ])('rejects invalid configuration %#', (env, message) => {
    expect(() => parseCipherConfig(env)).toThrow(CredentialCipherConfigError);
    expect(() => parseCipherConfig(env)).toThrow(message);
  });
});

describe('CredentialCipher', () => {
  it('round-trips and never stores plaintext', () => {
    const c = cipher(`k1:${K1}`, 'k1');
    const e = c.encrypt(ID, CREDS);
    expect(e.kekId).toBe('k1');
    expect(e.wrappedDek).toHaveLength(32);
    const stored = Buffer.concat([e.ciphertext, e.wrappedDek]).toString(
      'latin1',
    );
    for (const v of Object.values(CREDS)) expect(stored).not.toContain(v);
    expect(c.decrypt(ID, e)).toEqual(CREDS);
  });

  it('uses a fresh data key and IV per record', () => {
    const c = cipher(`k1:${K1}`, 'k1');
    const a = c.encrypt(ID, CREDS);
    const b = c.encrypt(ID, CREDS);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
  });

  it.each([
    ['tenant', { ...ID, tenantId: 't-2' }],
    ['account', { ...ID, accountId: 'a-2' }],
    ['channel', { ...ID, channel: 'hepsiburada' }],
  ])('refuses a ciphertext moved to another %s', (_label, other) => {
    const c = cipher(`k1:${K1}`, 'k1');
    expect(() => c.decrypt(other, c.encrypt(ID, CREDS))).toThrow(
      CredentialDecryptError,
    );
  });

  it('refuses tampered data, tag, wrapped key or unknown KEK', () => {
    const c = cipher(`k1:${K1}`, 'k1');
    const e = c.encrypt(ID, CREDS);
    const flip = (b: Buffer) => {
      const x = Buffer.from(b);
      x[0] ^= 1;
      return x;
    };
    expect(() =>
      c.decrypt(ID, { ...e, ciphertext: flip(e.ciphertext) }),
    ).toThrow(CredentialDecryptError);
    expect(() => c.decrypt(ID, { ...e, tag: flip(e.tag) })).toThrow(
      CredentialDecryptError,
    );
    expect(() =>
      c.decrypt(ID, { ...e, wrappedDek: flip(e.wrappedDek) }),
    ).toThrow(CredentialDecryptError);
    expect(() => c.decrypt(ID, { ...e, kekId: 'k9' })).toThrow(
      CredentialDecryptError,
    );
    expect(() => c.decrypt(ID, { ...e, tag: e.tag.subarray(0, 8) })).toThrow(
      CredentialDecryptError,
    );
  });

  it('a wrong key with the same id cannot decrypt', () => {
    const e = cipher(`k1:${K1}`, 'k1').encrypt(ID, CREDS);
    expect(() => cipher(`k1:${K2}`, 'k1').decrypt(ID, e)).toThrow(
      CredentialDecryptError,
    );
  });

  it('rotation re-wraps the data key only; old and new keys both needed until done', () => {
    const old = cipher(`k1:${K1}`, 'k1');
    const e = old.encrypt(ID, CREDS);
    const rotated = cipher(`k1:${K1},k2:${K2}`, 'k2');
    expect(rotated.needsRewrap(e)).toBe(true);
    expect(rotated.decrypt(ID, e)).toEqual(CREDS);
    const w = rotated.rewrap(ID, e);
    const after = { ...e, ...w };
    expect(after.kekId).toBe('k2');
    expect(after.ciphertext.equals(e.ciphertext)).toBe(true);
    expect(rotated.needsRewrap(after)).toBe(false);
    expect(cipher(`k2:${K2}`, 'k2').decrypt(ID, after)).toEqual(CREDS);
    expect(() => old.decrypt(ID, after)).toThrow(CredentialDecryptError);
  });

  it('decrypt errors carry no secret material', () => {
    const c = cipher(`k1:${K1}`, 'k1');
    try {
      c.decrypt({ ...ID, tenantId: 'x' }, c.encrypt(ID, CREDS));
    } catch (error) {
      expect(String(error)).not.toMatch(/key-abcdef|sec-xyz|123456/);
    }
  });
});

describe('maskSecret', () => {
  it('shows only the last 4 characters of long values', () => {
    expect(maskSecret('key-abcdef-1234')).toBe('••••1234');
    expect(maskSecret('12345678')).toBe('••••');
    expect(maskSecret('')).toBe('••••');
  });
});
