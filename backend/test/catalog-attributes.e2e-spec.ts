import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import {
  PRISMA,
  type TenantPrismaClient,
} from './../src/database/prisma.service.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import {
  createTestApp,
  ownerPool,
  purgeTenants,
  seedMember,
  systemRoleId,
} from './helpers.js';

const PASSWORD = 'Correct-Horse-9';

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}

let seq = 0;
const uniqueVkn = () =>
  vkn(
    String(Date.now() % 1e6).padStart(6, '0') + String(seq++).padStart(3, '0'),
  );

interface Attr {
  id: string;
  name: string;
  values: { id: string; value: string; sortOrder: number }[];
}

interface Variant {
  id: string;
  sku: string;
  attributes: {
    attributeId: string;
    attributeName: string;
    valueId: string;
    value: string;
  }[];
}

describe('Catalog variant attributes API (e2e, CAT-03)', () => {
  let app: INestApplication<App>;
  let prisma: TenantPrismaClient;
  const run = randomUUID().slice(0, 8);
  const slugs = [`attr-a-${run}`, `attr-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let tenantA: string;
  let companyX: string;
  let colour: Attr;
  let size: Attr;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const sku = (label: string) => `${label}-${run}`;
  const val = (a: Attr, v: string) => {
    const found = a.values.find((x) => x.value === v);
    if (!found) throw new Error(`no value ${v}`);
    return found.id;
  };
  const pair = (a: Attr, v: string) => ({
    attributeId: a.id,
    valueId: val(a, v),
  });

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

  const createAttr = async (name: string, values: string[]) =>
    (
      await http()
        .post('/api/v1/attributes')
        .set(bearer(tokenA))
        .send({ name, values })
        .expect(201)
    ).body.data as Attr;

  const createProduct = (variants: Record<string, unknown>[]) =>
    http()
      .post('/api/v1/products')
      .set(bearer(tokenA))
      .send({ companyId: companyX, name: `Tişört ${run}`, variants });

  const auditTypes = async (entityId: string) => {
    const pool = ownerPool();
    try {
      const { rows } = await pool.query<{
        action: string;
        entity_type: string;
      }>(
        `SELECT action, entity_type FROM audit_logs
         WHERE tenant_id = $1 AND entity_id = $2 ORDER BY created_at`,
        [tenantA, entityId],
      );
      return rows;
    } finally {
      await pool.end();
    }
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PRISMA);
    tokenA = await register(slugs[0]);
    tokenB = await register(slugs[1]);
    tenantA = (await http().get('/api/v1/auth/me').set(bearer(tokenA))).body
      .data.tenantId;
    companyX = (
      await http()
        .post('/api/v1/companies')
        .set(bearer(tokenA))
        .send({
          legalName: `X ${run}`,
          taxNumber: uniqueVkn(),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
        })
        .expect(201)
    ).body.data.id as string;
    colour = await createAttr('Renk', ['Kırmızı', 'Mavi', 'Yeşil']);
    size = await createAttr('Beden', ['S', 'M', 'XL']);
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  describe('attributes', () => {
    it('creates with ordered values, lists, gets and audits', async () => {
      expect(colour.values.map((v) => [v.value, v.sortOrder])).toEqual([
        ['Kırmızı', 0],
        ['Mavi', 1],
        ['Yeşil', 2],
      ]);
      const list = await http()
        .get('/api/v1/attributes?search=ren')
        .set(bearer(tokenA))
        .expect(200);
      expect(list.body.data.map((a: Attr) => a.id)).toEqual([colour.id]);
      await http()
        .get(`/api/v1/attributes/${colour.id}`)
        .set(bearer(tokenA))
        .expect(200);
      expect(await auditTypes(colour.id)).toEqual([
        { action: 'CREATE', entity_type: 'Attribute' },
      ]);
    });

    it('rejects a duplicate name case-insensitively and duplicate values', async () => {
      const dup = await http()
        .post('/api/v1/attributes')
        .set(bearer(tokenA))
        .send({ name: 'renk' })
        .expect(409);
      expect(dup.body.error.code).toBe('ATTRIBUTE_NAME_TAKEN');
      const values = await http()
        .post('/api/v1/attributes')
        .set(bearer(tokenA))
        .send({ name: 'Materyal', values: ['Pamuk', 'pamuk'] })
        .expect(409);
      expect(values.body.error.code).toBe('ATTRIBUTE_VALUE_TAKEN');
      const value = await http()
        .post(`/api/v1/attributes/${colour.id}/values`)
        .set(bearer(tokenA))
        .send({ value: 'mavi' })
        .expect(409);
      expect(value.body.error.code).toBe('ATTRIBUTE_VALUE_TAKEN');
    });

    it('adds, renames and deletes an unused value', async () => {
      const added = await http()
        .post(`/api/v1/attributes/${colour.id}/values`)
        .set(bearer(tokenA))
        .send({ value: 'Mor' })
        .expect(201);
      const mor = (added.body.data as Attr).values.find(
        (v) => v.value === 'Mor',
      );
      expect(mor?.sortOrder).toBe(3);
      await http()
        .patch(`/api/v1/attributes/${colour.id}/values/${mor?.id}`)
        .set(bearer(tokenA))
        .send({ value: 'Lila' })
        .expect(200);
      await http()
        .delete(`/api/v1/attributes/${colour.id}/values/${mor?.id}`)
        .set(bearer(tokenA))
        .expect(204);
      const after = await http()
        .get(`/api/v1/attributes/${colour.id}`)
        .set(bearer(tokenA))
        .expect(200);
      expect((after.body.data as Attr).values.map((v) => v.value)).toEqual([
        'Kırmızı',
        'Mavi',
        'Yeşil',
      ]);
    });

    it('is tenant-wide: a company role cannot write, another tenant cannot see', async () => {
      const email = `attr-op-${run}@test.local`;
      const roleId = await systemRoleId(tenantA, 'operations');
      const userId = await seedMember({
        email,
        name: 'Op',
        passwordHash: await hash(PASSWORD),
        memberships: [{ tenantId: tenantA }],
      });
      await TenantContext.run(tenantA, () =>
        prisma.userCompanyRole.createMany({
          data: [{ tenantId: tenantA, userId, companyId: companyX, roleId }],
        }),
      );
      const op = (
        await http()
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.data.accessToken as string;
      await http()
        .get(`/api/v1/attributes/${colour.id}`)
        .set(bearer(op))
        .expect(200);
      await http()
        .post('/api/v1/attributes')
        .set(bearer(op))
        .send({ name: 'Desen' })
        .expect(403);
      await http()
        .get(`/api/v1/attributes/${colour.id}`)
        .set(bearer(tokenB))
        .expect(404);
      await http()
        .patch(`/api/v1/attributes/${colour.id}`)
        .set(bearer(tokenB))
        .send({ name: 'Ele geçir' })
        .expect(404);
    });
  });

  describe('variants with attributes', () => {
    let productId: string;
    let variants: Variant[];

    it('creates a product whose variants carry attributes', async () => {
      const res = await createProduct([
        {
          sku: sku('k-s'),
          attributes: [pair(colour, 'Kırmızı'), pair(size, 'S')],
        },
        {
          sku: sku('k-m'),
          attributes: [pair(colour, 'Kırmızı'), pair(size, 'M')],
        },
      ]).expect(201);
      productId = res.body.data.id;
      variants = res.body.data.variants;
      expect(variants[0].attributes).toEqual([
        {
          attributeId: size.id,
          attributeName: 'Beden',
          valueId: val(size, 'S'),
          value: 'S',
        },
        {
          attributeId: colour.id,
          attributeName: 'Renk',
          valueId: val(colour, 'Kırmızı'),
          value: 'Kırmızı',
        },
      ]);
    });

    it('rejects a repeated combination, a foreign value and a repeated axis', async () => {
      const same = await createProduct([
        { sku: sku('d1'), attributes: [pair(colour, 'Mavi')] },
        { sku: sku('d2'), attributes: [pair(colour, 'Mavi')] },
      ]).expect(409);
      expect(same.body.error.code).toBe('VARIANT_COMBINATION_TAKEN');

      const taken = await http()
        .post(`/api/v1/products/${productId}/variants`)
        .set(bearer(tokenA))
        .send({
          sku: sku('k-s2'),
          attributes: [pair(size, 'S'), pair(colour, 'Kırmızı')],
        })
        .expect(409);
      expect(taken.body.error.code).toBe('VARIANT_COMBINATION_TAKEN');

      const foreign = await http()
        .post(`/api/v1/products/${productId}/variants`)
        .set(bearer(tokenA))
        .send({
          sku: sku('f'),
          attributes: [{ attributeId: size.id, valueId: val(colour, 'Mavi') }],
        })
        .expect(422);
      expect(foreign.body.error.code).toBe('ATTRIBUTE_UNAVAILABLE');

      const dupAxis = await http()
        .post(`/api/v1/products/${productId}/variants`)
        .set(bearer(tokenA))
        .send({
          sku: sku('dx'),
          attributes: [pair(colour, 'Mavi'), pair(colour, 'Yeşil')],
        })
        .expect(422);
      expect(dupAxis.body.error.code).toBe('ATTRIBUTE_DUPLICATE');

      // Another tenant's value does not exist here.
      const other = await http()
        .post('/api/v1/attributes')
        .set(bearer(tokenB))
        .send({ name: 'Renk', values: ['Siyah'] })
        .expect(201);
      const black = other.body.data as Attr;
      const cross = await http()
        .post(`/api/v1/products/${productId}/variants`)
        .set(bearer(tokenA))
        .send({ sku: sku('x'), attributes: [pair(black, 'Siyah')] })
        .expect(422);
      expect(cross.body.error.code).toBe('ATTRIBUTE_UNAVAILABLE');
    });

    it('changes one axis of a variant and keeps the other', async () => {
      const res = await http()
        .patch(`/api/v1/products/${productId}/variants/${variants[1].id}`)
        .set(bearer(tokenA))
        .send({ attributes: [pair(colour, 'Mavi')] })
        .expect(200);
      expect((res.body.data as Variant).attributes.map((a) => a.value)).toEqual(
        ['M', 'Mavi'],
      );
      // Onto variant 0's combination: refused.
      const clash = await http()
        .patch(`/api/v1/products/${productId}/variants/${variants[1].id}`)
        .set(bearer(tokenA))
        .send({ attributes: [pair(colour, 'Kırmızı'), pair(size, 'S')] })
        .expect(409);
      expect(clash.body.error.code).toBe('VARIANT_COMBINATION_TAKEN');
    });

    it('generates the missing combinations with readable SKUs', async () => {
      const body = {
        skuPrefix: `TS${run}`,
        axes: [
          {
            attributeId: colour.id,
            valueIds: [val(colour, 'Kırmızı'), val(colour, 'Mavi')],
          },
          {
            attributeId: size.id,
            valueIds: [val(size, 'S'), val(size, 'M'), val(size, 'XL')],
          },
        ],
      };
      const res = await http()
        .post(`/api/v1/products/${productId}/variants/generate`)
        .set(bearer(tokenA))
        .send(body)
        .expect(201);
      // Kırmızı/S and Mavi/M already exist.
      expect(res.body.data.skipped).toBe(2);
      const created = res.body.data.created as Variant[];
      expect(created.map((v) => v.sku)).toEqual([
        `TS${run}-KIRMIZI-M`,
        `TS${run}-KIRMIZI-XL`,
        `TS${run}-MAVI-S`,
        `TS${run}-MAVI-XL`,
      ]);
      expect(await auditTypes(created[0].id)).toEqual([
        { action: 'CREATE', entity_type: 'ProductVariant' },
      ]);

      const again = await http()
        .post(`/api/v1/products/${productId}/variants/generate`)
        .set(bearer(tokenA))
        .send(body)
        .expect(201);
      expect(again.body.data).toEqual({ created: [], skipped: 6 });

      const product = await http()
        .get(`/api/v1/products/${productId}`)
        .set(bearer(tokenA))
        .expect(200);
      expect(product.body.data.variants).toHaveLength(6);
    });

    it('rolls back a generation whose SKU is taken, and limits combinations', async () => {
      await createProduct([{ sku: `TK${run}-YESIL-S` }]).expect(201);
      const res = await http()
        .post(`/api/v1/products/${productId}/variants/generate`)
        .set(bearer(tokenA))
        .send({
          skuPrefix: `TK${run}`,
          axes: [
            { attributeId: colour.id, valueIds: [val(colour, 'Yeşil')] },
            {
              attributeId: size.id,
              valueIds: [val(size, 'XL'), val(size, 'S')],
            },
          ],
        })
        .expect(409);
      expect(res.body.error.code).toBe('SKU_TAKEN');
      const product = await http()
        .get(`/api/v1/products/${productId}`)
        .set(bearer(tokenA))
        .expect(200);
      expect(product.body.data.variants).toHaveLength(6);

      const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
      const many = await http()
        .post(`/api/v1/products/${productId}/variants/generate`)
        .set(bearer(tokenA))
        .send({
          skuPrefix: 'M',
          axes: [
            { attributeId: colour.id, valueIds: ids(11) },
            { attributeId: size.id, valueIds: ids(10) },
          ],
        })
        .expect(422);
      expect(many.body.error.code).toBe('TOO_MANY_COMBINATIONS');
    });

    it('refuses to delete a value or attribute in use until its variants are gone', async () => {
      const inUse = await http()
        .delete(`/api/v1/attributes/${size.id}/values/${val(size, 'XL')}`)
        .set(bearer(tokenA))
        .expect(409);
      expect(inUse.body.error.code).toBe('ATTRIBUTE_VALUE_IN_USE');
      const attrInUse = await http()
        .delete(`/api/v1/attributes/${size.id}`)
        .set(bearer(tokenA))
        .expect(409);
      expect(attrInUse.body.error.code).toBe('ATTRIBUTE_IN_USE');

      await http()
        .delete(`/api/v1/products/${productId}`)
        .set(bearer(tokenA))
        .expect(204);
      await http()
        .delete(`/api/v1/attributes/${size.id}/values/${val(size, 'XL')}`)
        .set(bearer(tokenA))
        .expect(204);
      await http()
        .delete(`/api/v1/attributes/${size.id}`)
        .set(bearer(tokenA))
        .expect(204);
      await http()
        .get(`/api/v1/attributes/${size.id}`)
        .set(bearer(tokenA))
        .expect(404);
      expect((await auditTypes(size.id)).map((r) => r.action)).toEqual([
        'CREATE',
        'DELETE',
      ]);
    });
  });
});
