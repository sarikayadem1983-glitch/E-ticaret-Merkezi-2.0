import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for channel credentials (INT-01).
 *
 * Every record gets its own random data key (DEK, AES-256-GCM). The credentials
 * are encrypted with the DEK; the DEK is encrypted ("wrapped") with a key
 * encryption key (KEK) from configuration. Only the wrapped DEK is stored.
 * Rotation re-wraps DEKs with the active KEK; the credential ciphertext does
 * not change.
 *
 * Both layers bind the record identity as additional authenticated data, so a
 * ciphertext copied to another tenant, account or channel fails to decrypt.
 *
 * Release A uses local KEKs from the environment. Production needs a KMS
 * (INF-13, risk R-25).
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEK_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export class CredentialCipherConfigError extends Error {}
export class CredentialDecryptError extends Error {
  constructor() {
    super('Kimlik bilgisi çözülemedi');
  }
}

export interface Kek {
  id: string;
  key: Buffer;
}

export interface CipherConfig {
  active: Kek;
  keys: Map<string, Buffer>;
}

/** Identity bound into both encryption layers. */
export interface RecordIdentity {
  tenantId: string;
  accountId: string;
  channel: string;
}

export interface EncryptedCredentials {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  wrappedDek: Buffer;
  dekIv: Buffer;
  dekTag: Buffer;
  kekId: string;
}

/**
 * Parses CHANNEL_KEKS ("id:base64key,id2:base64key") and CHANNEL_KEK_ACTIVE.
 * Returns null when CHANNEL_KEKS is empty (feature unavailable). Invalid values
 * throw: the app must not start with a broken key configuration.
 */
export function parseCipherConfig(
  env: Record<string, string | undefined>,
): CipherConfig | null {
  const raw = (env.CHANNEL_KEKS ?? '').trim();
  if (raw === '') {
    if ((env.CHANNEL_KEK_ACTIVE ?? '').trim() !== '') {
      throw new CredentialCipherConfigError(
        'CHANNEL_KEK_ACTIVE tanımlı ama CHANNEL_KEKS boş',
      );
    }
    return null;
  }
  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(',').map((e) => e.trim())) {
    const sep = entry.indexOf(':');
    const id = sep > 0 ? entry.slice(0, sep) : '';
    const material = sep > 0 ? entry.slice(sep + 1) : '';
    if (!KEK_ID.test(id)) {
      throw new CredentialCipherConfigError(
        'CHANNEL_KEKS: anahtar kimliği geçersiz (küçük harf, rakam, - _; en fazla 32)',
      );
    }
    if (keys.has(id)) {
      throw new CredentialCipherConfigError(
        `CHANNEL_KEKS: '${id}' kimliği iki kez tanımlı`,
      );
    }
    const key = Buffer.from(material, 'base64');
    if (key.length !== KEY_BYTES || key.toString('base64') !== material) {
      throw new CredentialCipherConfigError(
        `CHANNEL_KEKS: '${id}' anahtarı 32 baytlık base64 olmalı`,
      );
    }
    if (key.every((b) => b === key[0])) {
      throw new CredentialCipherConfigError(
        `CHANNEL_KEKS: '${id}' anahtarı zayıf (tek bayt tekrarı)`,
      );
    }
    keys.set(id, key);
  }
  const activeId = (env.CHANNEL_KEK_ACTIVE ?? '').trim();
  const active = keys.get(activeId);
  if (!active) {
    throw new CredentialCipherConfigError(
      'CHANNEL_KEK_ACTIVE, CHANNEL_KEKS içindeki bir kimlik olmalı',
    );
  }
  return { active: { id: activeId, key: active }, keys };
}

function aad(identity: RecordIdentity, layer: 'data' | 'dek', kekId = '') {
  return Buffer.from(
    [
      'tm-channel-credentials-v1',
      layer,
      identity.tenantId,
      identity.accountId,
      identity.channel,
      kekId,
    ].join('|'),
    'utf8',
  );
}

function seal(key: Buffer, plaintext: Buffer, additional: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(additional);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function open(
  key: Buffer,
  sealed: { ciphertext: Buffer; iv: Buffer; tag: Buffer },
  additional: Buffer,
): Buffer {
  if (sealed.iv.length !== IV_BYTES || sealed.tag.length !== TAG_BYTES) {
    throw new CredentialDecryptError();
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, sealed.iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(additional);
    decipher.setAuthTag(sealed.tag);
    return Buffer.concat([
      decipher.update(sealed.ciphertext),
      decipher.final(),
    ]);
  } catch {
    throw new CredentialDecryptError();
  }
}

export class CredentialCipher {
  constructor(private readonly config: CipherConfig) {}

  get activeKekId(): string {
    return this.config.active.id;
  }

  encrypt(
    identity: RecordIdentity,
    credentials: Record<string, string>,
  ): EncryptedCredentials {
    const dek = randomBytes(KEY_BYTES);
    try {
      const data = seal(
        dek,
        Buffer.from(JSON.stringify(credentials), 'utf8'),
        aad(identity, 'data'),
      );
      const wrapped = this.wrap(identity, dek);
      return {
        ciphertext: data.ciphertext,
        iv: data.iv,
        tag: data.tag,
        ...wrapped,
      };
    } finally {
      dek.fill(0);
    }
  }

  decrypt(
    identity: RecordIdentity,
    record: EncryptedCredentials,
  ): Record<string, string> {
    const dek = this.unwrap(identity, record);
    try {
      const plain = open(
        dek,
        { ciphertext: record.ciphertext, iv: record.iv, tag: record.tag },
        aad(identity, 'data'),
      );
      const parsed = JSON.parse(plain.toString('utf8')) as unknown;
      plain.fill(0);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.values(parsed).some((v) => typeof v !== 'string')
      ) {
        throw new CredentialDecryptError();
      }
      return parsed as Record<string, string>;
    } finally {
      dek.fill(0);
    }
  }

  /** True when the record's DEK is wrapped with a KEK other than the active one. */
  needsRewrap(record: Pick<EncryptedCredentials, 'kekId'>): boolean {
    return record.kekId !== this.config.active.id;
  }

  /** Re-wraps the DEK with the active KEK. The credential ciphertext is unchanged. */
  rewrap(
    identity: RecordIdentity,
    record: EncryptedCredentials,
  ): Pick<EncryptedCredentials, 'wrappedDek' | 'dekIv' | 'dekTag' | 'kekId'> {
    const dek = this.unwrap(identity, record);
    try {
      return this.wrap(identity, dek);
    } finally {
      dek.fill(0);
    }
  }

  private wrap(identity: RecordIdentity, dek: Buffer) {
    const { id, key } = this.config.active;
    const sealed = seal(key, dek, aad(identity, 'dek', id));
    return {
      wrappedDek: sealed.ciphertext,
      dekIv: sealed.iv,
      dekTag: sealed.tag,
      kekId: id,
    };
  }

  private unwrap(identity: RecordIdentity, record: EncryptedCredentials) {
    const kek = this.config.keys.get(record.kekId);
    if (!kek) throw new CredentialDecryptError();
    const dek = open(
      kek,
      { ciphertext: record.wrappedDek, iv: record.dekIv, tag: record.dekTag },
      aad(identity, 'dek', record.kekId),
    );
    if (dek.length !== KEY_BYTES) throw new CredentialDecryptError();
    return dek;
  }
}

/** Shows only the last 4 characters; short values are fully masked. */
export function maskSecret(value: string): string {
  const v = String(value);
  if (v.length <= 8) return '••••';
  return '••••' + v.slice(-4);
}
