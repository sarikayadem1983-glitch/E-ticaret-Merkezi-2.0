import { randomUUID } from 'node:crypto';
import { type Server, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { MAX_IMAGE_BYTES } from './../src/catalog/image-processing.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { loadStorageConfig } from './../src/storage/storage.config.js';
import {
  STORAGE_CLIENT,
  STORAGE_CONFIG,
  STORAGE_SIGNER,
} from './../src/storage/storage.service.js';
import {
  createTestApp,
  ownerPool,
  purgeTenants,
  registerOwner,
  seedMember,
} from './helpers.js';

const PASSWORD = 'Correct-Horse-9';

const uniqueVkn = () => {
  const p = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  return p + '0123456789'.split('').find((c) => isValidVkn(p + c));
};

/** In-memory bucket: API behaviour only. storage-live.e2e-spec.ts covers the real server. */
const objects = new Map<string, Uint8Array>();
let failRemoval = false;
const client = {
  send: (cmd: unknown) => {
    if (cmd instanceof PutObjectCommand) {
      objects.set(cmd.input.Key!, cmd.input.Body as Uint8Array);
    }
    if (cmd instanceof DeleteObjectCommand) {
      if (failRemoval) return Promise.reject(new Error('down'));
      objects.delete(cmd.input.Key!);
    }
    return Promise.resolve({});
  },
};
const signer = (_c: unknown, cmd: { input: { Key?: string } }) =>
  Promise.resolve(`https://signed.test/${cmd.input.Key}`);

interface Image {
  id: string;
  variantId: string | null;
  position: number;
  contentType: string;
  url: string;
}

describe('Product images API (e2e, IMG-01)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`img-a-${run}`, `img-b-${run}`];
  let a: string;
  let b: string;
  let company: string;
  let product: string;
  let variant: string;
  let otherVariant: string;
  let png: Buffer;
  const viewerEmail = `img-viewer-${run}@test.local`;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const url = (p = product) => `/api/v1/products/${p}/images`;
  const upload = (token: string, body: Buffer, p = product, query = '') =>
    http()
      .post(url(p) + query)
      .set(bearer(token))
      .set('Content-Type', 'application/octet-stream')
      .send(body);
  const list = async () =>
    (await http().get(url()).set(bearer(a)).expect(200)).body.data as Image[];

  const register = async (slug: string) =>
    (
      await registerOwner(app, {
        tenantName: `Mağaza ${slug}`,
        tenantSlug: slug,
        name: 'Sahip',
        email: `${slug}@test.local`,
        password: PASSWORD,
      })
    ).body.data.accessToken as string;

  const newProduct = async (name: string) =>
    (
      await http()
        .post('/api/v1/products')
        .set(bearer(a))
        .send({
          companyId: company,
          name,
          variants: [{ sku: `${name}-${run}` }],
        })
        .expect(201)
    ).body.data as { id: string; variants: { id: string }[] };

  beforeAll(async () => {
    png = await sharp({
      create: { width: 150, height: 120, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    app = await createTestApp(
      {},
      {
        providers: [
          {
            provide: STORAGE_CONFIG,
            useValue: loadStorageConfig({
              STORAGE_BUCKET: 'test',
              STORAGE_ACCESS_KEY: 'x',
              STORAGE_SECRET_KEY: 'y',
            }),
          },
          { provide: STORAGE_CLIENT, useValue: client },
          { provide: STORAGE_SIGNER, useValue: signer },
        ],
      },
    );
    a = await register(slugs[0]);
    b = await register(slugs[1]);
    company = (
      await http()
        .post('/api/v1/companies')
        .set(bearer(a))
        .send({
          legalName: `Görsel ${run}`,
          taxNumber: uniqueVkn(),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
        })
        .expect(201)
    ).body.data.id as string;
    const p1 = await newProduct('IMG1');
    product = p1.id;
    variant = p1.variants[0].id;
    otherVariant = (await newProduct('IMG2')).variants[0].id;
  });

  afterAll(async () => {
    await app?.close();
    const pool = ownerPool();
    await purgeTenants(slugs);
    await pool.query('DELETE FROM users WHERE email = $1', [viewerEmail]);
    await pool.end();
  });

  it('uploads, binds to a variant and lists with signed URLs under the tenant prefix', async () => {
    const tenantId = (await http().get('/api/v1/auth/me').set(bearer(a))).body
      .data.tenantId as string;
    await upload(a, png).expect(201);
    const res = await upload(a, png, product, `?variant_id=${variant}`);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      variantId: variant,
      position: 1,
      contentType: 'image/png',
      width: 150,
      height: 120,
    });
    expect(res.body.data.storageKey).toBeUndefined();
    expect(res.body.data.url).toContain(`/tenants/${tenantId}/products/`);
    expect((await list()).map((i) => i.position)).toEqual([0, 1]);
    expect(objects.size).toBe(2);
  });

  it('decides the type from the content, not from the client', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const before = objects.size;
    const res = await upload(a, svg).expect(422);
    expect(res.body.error.code).toBe('IMAGE_TYPE_UNSUPPORTED');
    await http()
      .post(url())
      .set(bearer(a))
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(415);
    expect(objects.size).toBe(before);
  });

  it('refuses bodies over the limit', async () => {
    const res = await upload(a, Buffer.alloc(MAX_IMAGE_BYTES + 1)).expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('refuses a streamed body far over the limit and stays up', async () => {
    const server = app.getHttpServer() as unknown as Server;
    if (!server.listening) await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as AddressInfo;
    const outcome = await new Promise<number | string>((resolve) => {
      const req = httpRequest(
        {
          port,
          path: url(),
          method: 'POST',
          headers: {
            ...bearer(a),
            'Content-Type': 'application/octet-stream',
            'Transfer-Encoding': 'chunked',
          },
        },
        (res) => {
          resolve(res.statusCode ?? 0);
          res.resume();
          req.destroy();
        },
      );
      req.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'));
      req.on('close', () => resolve('closed'));
      const chunk = Buffer.alloc(1024 * 1024);
      const write = () => {
        if (!req.destroyed) req.write(chunk, () => setImmediate(write));
      };
      write();
    });
    expect([
      413,
      'ECONNRESET',
      'ECONNABORTED',
      'EPIPE',
      'closed',
    ]).toContain(outcome);
    await http().get(url()).set(bearer(a)).expect(200);
  });

  it("refuses another product's variant, also when re-binding", async () => {
    const before = objects.size;
    await upload(a, png, product, `?variant_id=${otherVariant}`).expect(404);
    expect(objects.size).toBe(before);
    const [first] = await list();
    await http()
      .patch(`${url()}/${first.id}`)
      .set(bearer(a))
      .send({ variantId: otherVariant })
      .expect(404);
    await http()
      .patch(`${url()}/${first.id}`)
      .set(bearer(a))
      .send({ variantId: variant })
      .expect(200);
    const res = await http()
      .patch(`${url()}/${first.id}`)
      .set(bearer(a))
      .send({ variantId: null })
      .expect(200);
    expect(res.body.data.variantId).toBeNull();
  });

  it('reorders; stale or foreign lists are refused and change nothing', async () => {
    const [x, y] = await list();
    for (const ids of [[x.id], [x.id, randomUUID()], [x.id, y.id, y.id]]) {
      await http()
        .put(`${url()}/order`)
        .set(bearer(a))
        .send({ imageIds: ids })
        .expect(422);
    }
    expect((await list()).map((i) => i.id)).toEqual([x.id, y.id]);
    const res = await http()
      .put(`${url()}/order`)
      .set(bearer(a))
      .send({ imageIds: [y.id, x.id] })
      .expect(200);
    expect(res.body.data.map((i: Image) => i.id)).toEqual([y.id, x.id]);
  });

  it('tenant isolation: another tenant sees and changes nothing (404)', async () => {
    const [x] = await list();
    const before = objects.size;
    await http().get(url()).set(bearer(b)).expect(404);
    await upload(b, png).expect(404);
    await http().delete(`${url()}/${x.id}`).set(bearer(b)).expect(404);
    await http()
      .patch(`${url()}/${x.id}`)
      .set(bearer(b))
      .send({ variantId: null })
      .expect(404);
    await http()
      .put(`${url()}/order`)
      .set(bearer(b))
      .send({ imageIds: [x.id] })
      .expect(404);
    expect(objects.size).toBe(before);
    expect((await list()).length).toBe(2);
    await http().get(url()).expect(401);
  });

  it('a company viewer reads but cannot write (403)', async () => {
    const pool = ownerPool();
    const { rows } = await pool.query<{ tenant_id: string; hash: string }>(
      `SELECT m.tenant_id, u.password_hash AS hash FROM users u
       JOIN tenant_memberships m ON m.user_id = u.id WHERE u.email = $1`,
      [`${slugs[0]}@test.local`],
    );
    const tenantId = rows[0].tenant_id;
    const userId = await seedMember({
      email: viewerEmail,
      name: 'İzleyici',
      passwordHash: rows[0].hash,
      memberships: [{ tenantId }],
      lastTenantId: tenantId,
    });
    await pool.query(
      `INSERT INTO user_company_roles (tenant_id, user_id, company_id, role_id)
       SELECT $1, $2, $3, id FROM roles WHERE tenant_id = $1 AND key = 'viewer'`,
      [tenantId, userId, company],
    );
    await pool.end();
    const viewer = (
      await http()
        .post('/api/v1/auth/login')
        .send({ email: viewerEmail, password: PASSWORD })
        .expect(200)
    ).body.data.accessToken as string;
    await http().get(url()).set(bearer(viewer)).expect(200);
    const before = objects.size;
    await upload(viewer, png).expect(403);
    const [x] = await list();
    await http().delete(`${url()}/${x.id}`).set(bearer(viewer)).expect(403);
    expect(objects.size).toBe(before);
  });

  it('deletes the row and the object; a failing object removal does not fail the request', async () => {
    const [x, y] = await list();
    await http().delete(`${url()}/${x.id}`).set(bearer(a)).expect(204);
    expect(objects.size).toBe(1);
    await http().delete(`${url()}/${x.id}`).set(bearer(a)).expect(404);
    failRemoval = true;
    await http().delete(`${url()}/${y.id}`).set(bearer(a)).expect(204);
    failRemoval = false;
    expect(await list()).toEqual([]);
  });

  it('audits every change', async () => {
    const pool = ownerPool();
    const { rows } = await pool.query<{ action: string }>(
      `SELECT DISTINCT l.action::text FROM audit_logs l JOIN tenants t ON t.id = l.tenant_id
       WHERE t.slug = $1 AND l.entity_type = 'ProductImage' ORDER BY 1`,
      [slugs[0]],
    );
    const leaked = await pool.query(
      "SELECT 1 FROM audit_logs WHERE entity_type = 'ProductImage' AND (after::text LIKE '%tenants/%' OR before::text LIKE '%tenants/%')",
    );
    await pool.end();
    expect(leaked.rowCount).toBe(0);
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'DELETE', 'UPDATE']);
  });

  it('stops at 20 images', async () => {
    const p = (await newProduct('IMG3')).id;
    for (let i = 0; i < 20; i++) await upload(a, png, p).expect(201);
    const res = await upload(a, png, p).expect(409);
    expect(res.body.error.code).toBe('IMAGE_LIMIT');
  }, 60_000);
});
