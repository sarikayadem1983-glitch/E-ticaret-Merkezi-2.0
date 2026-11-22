import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { config } from 'dotenv';
import { loadStorageConfig } from './../src/storage/storage.config.js';
import {
  createS3Client,
  defaultSigner,
  StorageService,
} from './../src/storage/storage.service.js';

config({ path: '../.env', quiet: true });
const storage = loadStorageConfig(process.env);

/** INF-12 against a real S3 server (local MinIO). Skipped where none is configured (CI). */
describe.skipIf(!storage?.endpoint)('Object storage (live, INF-12)', () => {
  const A = randomUUID();
  const B = randomUUID();
  const body = new TextEncoder().encode('gizli içerik A');
  const make = (ttl = 60) => {
    const c = { ...storage!, signedUrlTtlSeconds: ttl };
    return new StorageService(c, createS3Client(c), defaultSigner);
  };
  let svc: StorageService;
  let keyA: string;

  beforeAll(async () => {
    svc = make();
    keyA = await svc.put(A, ['products'], body, 'image/png', 'png');
  });
  afterAll(() => svc.remove(A, keyA));

  it('serves the exact bytes through a signed URL', async () => {
    const res = await fetch(await svc.signedUrl(A, keyA));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
  });

  it("refuses to sign or delete another tenant's object; the object survives", async () => {
    await expect(svc.signedUrl(B, keyA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.remove(B, keyA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect((await fetch(await svc.signedUrl(A, keyA))).status).toBe(200);
  });

  it('refuses anonymous reads and bucket listing', async () => {
    const base = `${storage!.endpoint}/${storage!.bucket}`;
    expect((await fetch(`${base}/${keyA}`)).status).toBe(403);
    expect((await fetch(`${base}/?list-type=2`)).status).toBe(403);
  });

  it('refuses a signature moved to another key, a changed expiry or method', async () => {
    const other = await svc.put(B, ['products'], body, 'image/png', 'png');
    try {
      const url = await svc.signedUrl(A, keyA);
      const moved = new URL(url);
      moved.pathname = `/${storage!.bucket}/${other}`;
      expect((await fetch(moved)).status).toBe(403);
      const longer = new URL(url);
      longer.searchParams.set('X-Amz-Expires', '3600');
      expect((await fetch(longer)).status).toBe(403);
      expect((await fetch(url, { method: 'DELETE' })).status).toBe(403);
      expect((await fetch(url, { method: 'PUT', body: 'x' })).status).toBe(403);
    } finally {
      await svc.remove(B, other);
    }
  });

  it('expires', async () => {
    const url = await make(1).signedUrl(A, keyA);
    await new Promise((r) => setTimeout(r, 2500));
    expect((await fetch(url)).status).toBe(403);
  });

  it('is gone after removal', async () => {
    const key = await svc.put(A, ['products'], body, 'image/png', 'png');
    const url = await svc.signedUrl(A, key);
    await svc.remove(A, key);
    expect((await fetch(url)).status).toBe(404);
  });
});
