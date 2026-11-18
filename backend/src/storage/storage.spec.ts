import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  assertTenantKey,
  newObjectKey,
  ObjectKeyError,
  tenantPrefix,
} from './object-key.js';
import { loadStorageConfig, StorageConfigError } from './storage.config.js';
import { type Signer, StorageService } from './storage.service.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const BASE = {
  STORAGE_BUCKET: 'tm-dev',
  STORAGE_ACCESS_KEY: 'access',
  STORAGE_SECRET_KEY: 'secret-value',
};

describe('loadStorageConfig', () => {
  it('is disabled without a bucket outside production', () => {
    expect(loadStorageConfig({})).toBeUndefined();
  });

  it('requires a bucket in production', () => {
    expect(() => loadStorageConfig({ NODE_ENV: 'production' })).toThrow(
      StorageConfigError,
    );
  });

  it('parses a MinIO setup with path-style URLs by default', () => {
    const c = loadStorageConfig({
      ...BASE,
      STORAGE_ENDPOINT: 'http://127.0.0.1:9000/',
    });
    expect(c).toMatchObject({
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'tm-dev',
      forcePathStyle: true,
      signedUrlTtlSeconds: 300,
    });
  });

  it('rejects bad values without echoing the secret', () => {
    const bad = [
      { ...BASE, STORAGE_BUCKET: 'Tm_Dev' },
      { ...BASE, STORAGE_SECRET_KEY: '' },
      { ...BASE, STORAGE_ENDPOINT: 'ftp://x' },
      { ...BASE, STORAGE_ENDPOINT: 'http://u:p@x' },
      { ...BASE, STORAGE_SIGNED_URL_TTL: '0' },
      { ...BASE, STORAGE_SIGNED_URL_TTL: '3601' },
      { ...BASE, STORAGE_FORCE_PATH_STYLE: 'yes' },
      { ...BASE, NODE_ENV: 'production', STORAGE_ENDPOINT: 'http://minio' },
    ];
    for (const env of bad) {
      let message = '';
      try {
        loadStorageConfig(env);
      } catch (e) {
        expect(e).toBeInstanceOf(StorageConfigError);
        message = (e as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toContain('secret-value');
    }
  });
});

describe('object keys', () => {
  it('builds unique tenant-prefixed keys', () => {
    const a = newObjectKey(T1, ['products', 'images'], 'webp');
    const b = newObjectKey(T1, ['products', 'images'], 'webp');
    expect(a).toMatch(
      new RegExp(`^tenants/${T1}/products/images/[0-9a-f-]{36}\\.webp$`),
    );
    expect(a).not.toBe(b);
    expect(() => assertTenantKey(T1, a)).not.toThrow();
  });

  it('refuses unsafe segments, extensions and tenant ids', () => {
    expect(() => newObjectKey(T1, ['..'])).toThrow(ObjectKeyError);
    expect(() => newObjectKey(T1, ['a/b'])).toThrow(ObjectKeyError);
    expect(() => newObjectKey(T1, [])).toThrow(ObjectKeyError);
    expect(() => newObjectKey(T1, ['x'], 'p/ng')).toThrow(ObjectKeyError);
    expect(() => tenantPrefix('../x')).toThrow(ObjectKeyError);
  });

  it("refuses another tenant's key and traversal tricks", () => {
    const other = newObjectKey(T2, ['products']);
    expect(() => assertTenantKey(T1, other)).toThrow(ObjectKeyError);
    const own = newObjectKey(T1, ['products']);
    expect(() => assertTenantKey(T1, `${own}/../../${T2}`)).toThrow();
    expect(() =>
      assertTenantKey(T1, `tenants/${T1}/../${T2}/products/x`),
    ).toThrow();
    expect(() => assertTenantKey(T1, `/${own}`)).toThrow();
  });
});

describe('StorageService', () => {
  const config = loadStorageConfig({ ...BASE })!;

  function service() {
    const send = vi.fn().mockResolvedValue({});
    const signer = vi.fn<Signer>().mockResolvedValue('https://signed.test/x');
    return { svc: new StorageService(config, { send }, signer), send, signer };
  }

  it('stores under the tenant prefix', async () => {
    const { svc, send } = service();
    const key = await svc.put(
      T1,
      ['products'],
      new Uint8Array([1, 2]),
      'image/png',
      'png',
    );
    expect(key.startsWith(`tenants/${T1}/products/`)).toBe(true);
    const cmd = send.mock.calls[0][0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toMatchObject({
      Bucket: 'tm-dev',
      Key: key,
      ContentType: 'image/png',
      ContentLength: 2,
    });
  });

  it('signs and deletes only own objects', async () => {
    const { svc, send, signer } = service();
    const own = newObjectKey(T1, ['products']);
    await expect(svc.signedUrl(T1, own)).resolves.toBe('https://signed.test/x');
    const [, cmd, opts] = signer.mock.calls[0];
    expect(cmd).toBeInstanceOf(GetObjectCommand);
    expect(opts).toEqual({ expiresIn: 300 });
    await svc.remove(T1, own);
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);

    const foreign = newObjectKey(T2, ['products']);
    await expect(svc.signedUrl(T1, foreign)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.remove(T1, foreign)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(signer).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when storage is not configured', async () => {
    const svc = new StorageService(undefined, undefined, vi.fn<Signer>());
    expect(svc.enabled).toBe(false);
    await expect(
      svc.put(T1, ['products'], new Uint8Array(), 'image/png'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
