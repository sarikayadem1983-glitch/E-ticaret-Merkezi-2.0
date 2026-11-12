import { randomBytes, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ChannelsService } from './../src/channels/channels.service.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import {
  createTestApp,
  ownerPool,
  purgeTenants,
  seedMember,
  systemRoleId,
} from './helpers.js';

const PASSWORD = 'Correct-Horse-9';
const K1 = randomBytes(32).toString('base64');
const K2 = randomBytes(32).toString('base64');

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}
let seq = 0;
const uniqueVkn = () =>
  vkn(String((Date.now() + seq++) % 1e9).padStart(9, '0'));

const CREDS = {
  supplierId: '987654',
  apiKey: 'ak-live-abcdefgh-1111',
  apiSecret: 'as-live-zyxwvuts-2222',
};

describe('Channel accounts API (e2e, INT-01)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`chan-a-${run}`, `chan-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let tenantA: string;
  let companyX: string;
  let companyB: string;
  let accountId: string;
  const saved: Record<string, string | undefined> = {};

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const url = (company = companyX, id = '') =>
    `/api/v1/companies/${company}/channel-accounts${id ? `/${id}` : ''}`;

  const register = async (slug: string) =>
    (
      await http()
        .post('/api/v1/auth/register')
        .send({
          tenantName: `Mağaza ${slug}`,
          tenantSlug: slug,
          name: 'Sahip',
          email: `${slug}@test.local`,
          password: PASSWORD,
        })
        .expect(201)
    ).body.data.accessToken as string;

  const company = async (token: string) =>
    (
      await http()
        .post('/api/v1/companies')
        .set(bearer(token))
        .send({
          legalName: `Firma ${run} ${seq}`,
          taxNumber: uniqueVkn(),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
        })
        .expect(201)
    ).body.data.id as string;

  const login = async (email: string) =>
    (
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200)
    ).body.data.accessToken as string;

  /** Operations role in companyX only (company-scoped, no tenant role). */
  const operator = async () => {
    const email = `chan-op-${run}@test.local`;
    const roleId = await systemRoleId(tenantA, 'operations');
    const userId = await seedMember({
      email,
      name: 'Operasyon',
      passwordHash: await hash(PASSWORD),
      lastTenantId: tenantA,
      memberships: [{ tenantId: tenantA }],
    });
    const pool = ownerPool();
    try {
      await pool.query(
        `INSERT INTO user_company_roles (tenant_id, user_id, company_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [tenantA, userId, companyX, roleId],
      );
    } finally {
      await pool.end();
    }
    return login(email);
  };

  const admin = async () => {
    const email = `chan-admin-${run}@test.local`;
    await seedMember({
      email,
      name: 'Admin',
      passwordHash: await hash(PASSWORD),
      lastTenantId: tenantA,
      memberships: [
        { tenantId: tenantA, roleId: await systemRoleId(tenantA, 'admin') },
      ],
    });
    return login(email);
  };

  const storedRow = async (id: string) => {
    const pool = ownerPool();
    try {
      const { rows } = await pool.query(
        `SELECT credentials_ciphertext, wrapped_dek, kek_id, credentials_hint, deleted_at
         FROM channel_accounts WHERE id = $1`,
        [id],
      );
      return rows[0];
    } finally {
      await pool.end();
    }
  };

  beforeAll(async () => {
    for (const key of ['CHANNEL_KEKS', 'CHANNEL_KEK_ACTIVE']) {
      saved[key] = process.env[key];
    }
    process.env.CHANNEL_KEKS = `e2e1:${K1},e2e2:${K2}`;
    process.env.CHANNEL_KEK_ACTIVE = 'e2e1';
    app = await createTestApp();
    tokenA = await register(slugs[0]);
    tokenB = await register(slugs[1]);
    tenantA = (await http().get('/api/v1/auth/me').set(bearer(tokenA))).body
      .data.tenantId;
    companyX = await company(tokenA);
    companyB = await company(tokenB);
  });

  afterAll(async () => {
    await app?.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await purgeTenants(slugs);
  });

  it('owner creates an account; response and audit are masked', async () => {
    const res = await http()
      .post(url())
      .set(bearer(tokenA))
      .send({ channel: 'trendyol', name: ' Ana mağaza ', credentials: CREDS })
      .expect(201);
    accountId = res.body.data.id;
    expect(res.body.data).toMatchObject({
      companyId: companyX,
      channel: 'trendyol',
      name: 'Ana mağaza',
      isActive: true,
      credentials: {
        supplierId: '••••',
        apiKey: '••••1111',
        apiSecret: '••••2222',
      },
    });
    const body = JSON.stringify(res.body);
    for (const v of Object.values(CREDS)) expect(body).not.toContain(v);

    const audit = await http()
      .get('/api/v1/audit-logs')
      .query({ entity_type: 'ChannelAccount' })
      .set(bearer(tokenA));
    if (audit.status === 200) {
      const text = JSON.stringify(audit.body);
      for (const v of Object.values(CREDS)) expect(text).not.toContain(v);
    }
  });

  it('stores only ciphertext under the active key', async () => {
    const row = await storedRow(accountId);
    expect(row.kek_id).toBe('e2e1');
    expect(row.wrapped_dek).toHaveLength(32);
    const raw = Buffer.concat([
      row.credentials_ciphertext,
      row.wrapped_dek,
    ]).toString('latin1');
    for (const v of Object.values(CREDS)) expect(raw).not.toContain(v);
    expect(JSON.stringify(row.credentials_hint)).not.toContain('abcdefgh');
  });

  it('credentialsFor decrypts for adapters inside the tenant context', async () => {
    const service = app.get(ChannelsService);
    await expect(
      TenantContext.run(tenantA, () =>
        service.credentialsFor(companyX, accountId),
      ),
    ).resolves.toEqual(CREDS);
  });

  it('lists and gets masked accounts', async () => {
    const list = await http().get(url()).set(bearer(tokenA)).expect(200);
    expect(list.body.data.map((a: { id: string }) => a.id)).toEqual([
      accountId,
    ]);
    await http().get(url(companyX, accountId)).set(bearer(tokenA)).expect(200);
  });

  it('validates channel and credential fields (422) without echoing values', async () => {
    const bad = await http()
      .post(url())
      .set(bearer(tokenA))
      .send({
        channel: 'trendyol',
        name: 'Eksik',
        credentials: {
          supplierId: 'abc',
          apiKey: 'secret-value-x',
          extra: 'y',
        },
      })
      .expect(422);
    expect(JSON.stringify(bad.body)).not.toContain('secret-value-x');
    const fields = bad.body.error.details.map(
      (d: { field: string }) => d.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining([
        'credentials.supplierId',
        'credentials.apiSecret',
        'credentials.extra',
      ]),
    );
    await http()
      .post(url())
      .set(bearer(tokenA))
      .send({ channel: 'amazon', name: 'X', credentials: CREDS })
      .expect(422);
  });

  it('rejects a duplicate name in the same company (409)', async () => {
    await http()
      .post(url())
      .set(bearer(tokenA))
      .send({ channel: 'trendyol', name: 'ANA MAĞAZA', credentials: CREDS })
      .expect(409);
  });

  it('updates name and replaces credentials; hint changes', async () => {
    const res = await http()
      .patch(url(companyX, accountId))
      .set(bearer(tokenA))
      .send({
        name: 'Yeni ad',
        credentials: { ...CREDS, apiSecret: 'as-new-secret-3333' },
      })
      .expect(200);
    expect(res.body.data.name).toBe('Yeni ad');
    expect(res.body.data.credentials.apiSecret).toBe('••••3333');
    const service = app.get(ChannelsService);
    const plain = await TenantContext.run(tenantA, () =>
      service.credentialsFor(companyX, accountId),
    );
    expect(plain.apiSecret).toBe('as-new-secret-3333');
  });

  it('admin can manage; company-scoped roles cannot (403)', async () => {
    await http()
      .get(url())
      .set(bearer(await admin()))
      .expect(200);
    const op = await operator();
    await http().get(url()).set(bearer(op)).expect(403);
    await http()
      .post(url())
      .set(bearer(op))
      .send({ channel: 'trendyol', name: 'X', credentials: CREDS })
      .expect(403);
  });

  it('another tenant cannot see or change the account (404)', async () => {
    await http().get(url()).set(bearer(tokenB)).expect(404);
    await http().get(url(companyX, accountId)).set(bearer(tokenB)).expect(404);
    await http()
      .patch(url(companyX, accountId))
      .set(bearer(tokenB))
      .send({ name: 'ele geçir' })
      .expect(404);
    await http().get(url(companyB, accountId)).set(bearer(tokenB)).expect(404);
    await http()
      .post(url(companyB))
      .set(bearer(tokenA))
      .send({ channel: 'trendyol', name: 'X', credentials: CREDS })
      .expect(404);
  });

  it('rotation re-wraps data keys with the new active key', async () => {
    await app.close();
    process.env.CHANNEL_KEK_ACTIVE = 'e2e2';
    app = await createTestApp();
    const service = app.get(ChannelsService);
    const result = await TenantContext.run(tenantA, () => service.rewrapAll());
    expect(result.failed).toBe(0);
    expect(result.rewrapped).toBeGreaterThanOrEqual(1);
    expect((await storedRow(accountId)).kek_id).toBe('e2e2');
    await expect(
      TenantContext.run(tenantA, () =>
        service.credentialsFor(companyX, accountId),
      ),
    ).resolves.toMatchObject({ supplierId: CREDS.supplierId });
  });

  it('soft-deletes; deleted account is gone from the API', async () => {
    await http()
      .delete(url(companyX, accountId))
      .set(bearer(tokenA))
      .expect(204);
    await http().get(url(companyX, accountId)).set(bearer(tokenA)).expect(404);
    expect((await storedRow(accountId)).deleted_at).not.toBeNull();
  });
});
