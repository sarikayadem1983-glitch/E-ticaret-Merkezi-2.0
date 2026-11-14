/**
 * INT-03 connection test against a fake Trendyol server on loopback. No real
 * marketplace is called. Live calls are switched on only for this app.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { trendyolBaseUrl } from './../src/channels/trendyol.adapter.js';
import { createTestApp, purgeTenants } from './helpers.js';

const PASSWORD = 'Correct-Horse-9';
const GOOD = {
  supplierId: '123456',
  apiKey: 'ak-ct-1111',
  apiSecret: 'as-ct-2222',
};
const BAD = { ...GOOD, apiSecret: 'wrong-secret' };

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}
let seq = 0;
const uniqueVkn = () =>
  vkn(String((Date.now() + seq++) % 1e9).padStart(9, '0'));

describe('Channel connection test (e2e, INT-03)', () => {
  let app: INestApplication<App>;
  let fake: Server;
  const seen: { url?: string; method?: string; auth?: string; ua?: string }[] =
    [];
  const run = randomUUID().slice(0, 8);
  const slugs = [`ct-a-${run}`, `ct-b-${run}`];
  const saved: Record<string, string | undefined> = {};
  let tokenA: string;
  let tokenB: string;
  let companyA: string;
  let good: string;
  let bad: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const testUrl = (company: string, id: string) =>
    `/api/v1/companies/${company}/channel-accounts/${id}/test-connection`;

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
  const account = async (name: string, credentials: Record<string, string>) =>
    (
      await http()
        .post(`/api/v1/companies/${companyA}/channel-accounts`)
        .set(bearer(tokenA))
        .send({ channel: 'trendyol', name, credentials })
        .expect(201)
    ).body.data.id as string;

  beforeAll(async () => {
    fake = createServer((req: IncomingMessage, res) => {
      seen.push({
        url: req.url,
        method: req.method,
        auth: req.headers.authorization,
        ua: req.headers['user-agent'],
      });
      const expected = `Basic ${Buffer.from(`${GOOD.apiKey}:${GOOD.apiSecret}`).toString('base64')}`;
      res.statusCode = req.headers.authorization === expected ? 200 : 401;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          content: [],
          echo: 'response bodies are not returned',
        }),
      );
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const port = (fake.address() as AddressInfo).port;
    for (const key of [
      'CHANNEL_KEKS',
      'CHANNEL_KEK_ACTIVE',
      'SYNC_LIVE_CALLS',
      'TRENDYOL_API_BASE',
    ]) {
      saved[key] = process.env[key];
    }
    process.env.CHANNEL_KEKS = `e2ect:${randomBytes(32).toString('base64')}`;
    process.env.CHANNEL_KEK_ACTIVE = 'e2ect';
    process.env.SYNC_LIVE_CALLS = 'true';
    process.env.TRENDYOL_API_BASE = `http://127.0.0.1:${port}`;
    app = await createTestApp();
    tokenA = await register(slugs[0]);
    tokenB = await register(slugs[1]);
    companyA = await company(tokenA);
    good = await account('Doğru', GOOD);
    bad = await account('Yanlış', BAD);
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((resolve) => fake?.close(resolve));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await purgeTenants(slugs);
  });

  it('lists channel definitions without validation patterns', async () => {
    const res = await http()
      .get('/api/v1/channel-definitions')
      .set(bearer(tokenA))
      .expect(200);
    const trendyol = res.body.data.find(
      (d: { code: string }) => d.code === 'trendyol',
    );
    expect(trendyol).toMatchObject({ name: 'Trendyol', connectionTest: true });
    expect(
      trendyol.credentialFields.map((f: { key: string }) => f.key),
    ).toEqual(['supplierId', 'apiKey', 'apiSecret']);
    for (const f of trendyol.credentialFields)
      expect(f).not.toHaveProperty('pattern');
  });

  it('accepted credentials → ok; one read-only GET with Basic auth and the seller User-Agent', async () => {
    seen.length = 0;
    const res = await http()
      .post(testUrl(companyA, good))
      .set(bearer(tokenA))
      .expect(200);
    expect(res.body.data).toMatchObject({ ok: true, code: 'OK' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: 'GET',
      url: `/integration/product/sellers/${GOOD.supplierId}/products?page=0&size=1`,
      ua: `${GOOD.supplierId} - SelfIntegration`,
    });
    expect(JSON.stringify(res.body)).not.toContain(GOOD.apiSecret);
    expect(JSON.stringify(res.body)).not.toContain('response bodies');
  });

  it('rejected credentials → INVALID_CREDENTIALS with a Turkish message, no secret echoed', async () => {
    const res = await http()
      .post(testUrl(companyA, bad))
      .set(bearer(tokenA))
      .expect(200);
    expect(res.body.data).toMatchObject({
      ok: false,
      code: 'INVALID_CREDENTIALS',
    });
    expect(res.body.data.message).toMatch(/reddetti/);
    expect(JSON.stringify(res.body)).not.toContain(BAD.apiSecret);
  });

  it('inactive accounts are not tested; other tenants get 404', async () => {
    await http()
      .patch(`/api/v1/companies/${companyA}/channel-accounts/${bad}`)
      .set(bearer(tokenA))
      .send({ isActive: false })
      .expect(200);
    seen.length = 0;
    const res = await http()
      .post(testUrl(companyA, bad))
      .set(bearer(tokenA))
      .expect(200);
    expect(res.body.data.code).toBe('ACCOUNT_INACTIVE');
    expect(seen).toHaveLength(0);
    await http().post(testUrl(companyA, good)).set(bearer(tokenB)).expect(404);
    expect(seen).toHaveLength(0);
  });

  it('manual tests are limited per account (429 after 5 a minute)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await http().post(testUrl(companyA, good)).set(bearer(tokenA))).status,
      );
    }
    expect(statuses).toContain(429);
  });
});

describe('trendyolBaseUrl', () => {
  it('allows https and loopback http only', () => {
    expect(trendyolBaseUrl(undefined)).toBe('https://apigw.trendyol.com');
    expect(trendyolBaseUrl('https://stageapigw.trendyol.com/')).toBe(
      'https://stageapigw.trendyol.com',
    );
    expect(trendyolBaseUrl('http://127.0.0.1:9999')).toBe(
      'http://127.0.0.1:9999',
    );
    expect(() => trendyolBaseUrl('http://example.com')).toThrow();
  });
});
