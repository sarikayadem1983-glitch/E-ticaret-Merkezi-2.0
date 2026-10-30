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

interface Variant {
  id: string;
  sku: string;
  barcode: string | null;
}

interface Product {
  id: string;
  companyId: string;
  categoryId: string | null;
  brandId: string | null;
  name: string;
  status: string;
  variants: Variant[];
}

describe('Catalog API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: TenantPrismaClient;
  const run = randomUUID().slice(0, 8);
  const slugs = [`cat-a-${run}`, `cat-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let tenantA: string;
  let companyX: string;
  let companyY: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const sku = (label: string) => `${label}-${run}`;

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

  const createCompany = async (token: string, legalName: string) =>
    (
      await http()
        .post('/api/v1/companies')
        .set(bearer(token))
        .send({
          legalName,
          taxNumber: uniqueVkn(),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
        })
        .expect(201)
    ).body.data.id as string;

  const createProduct = async (token: string, body: Record<string, unknown>) =>
    (
      await http()
        .post('/api/v1/products')
        .set(bearer(token))
        .send(body)
        .expect(201)
    ).body.data as Product;

  const productBody = (label: string, extra: Record<string, unknown> = {}) => ({
    companyId: companyX,
    name: `Ürün ${label}`,
    variants: [{ sku: sku(label) }],
    ...extra,
  });

  /** A member of tenant A with a company role in the given companies, or admin tenant-wide. */
  const memberWith = async (
    label: string,
    role: 'admin' | 'operations' | 'accounting' | 'viewer',
    companyIds: string[] = [],
  ) => {
    const email = `cat-${label}-${run}@test.local`;
    const roleId = await systemRoleId(tenantA, role);
    const userId = await seedMember({
      email,
      name: label,
      passwordHash: await hash(PASSWORD),
      memberships: [
        { tenantId: tenantA, ...(role === 'admin' ? { roleId } : {}) },
      ],
    });
    await TenantContext.run(tenantA, () =>
      prisma.userCompanyRole.createMany({
        data: companyIds.map((companyId) => ({
          tenantId: tenantA,
          userId,
          companyId,
          roleId,
        })),
      }),
    );
    return (
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200)
    ).body.data.accessToken as string;
  };

  const auditRows = async (entityId: string) => {
    const pool = ownerPool();
    try {
      const { rows } = await pool.query<{
        action: string;
        module: string;
        entity_type: string;
      }>(
        `SELECT action, module, entity_type FROM audit_logs
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
    companyX = await createCompany(tokenA, `X ${run}`);
    companyY = await createCompany(tokenA, `Y ${run}`);
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('requires authentication', async () => {
    await http().get('/api/v1/products').expect(401);
    await http().get('/api/v1/categories').expect(401);
    await http().get('/api/v1/brands').expect(401);
  });

  describe('categories', () => {
    it('creates, lists, updates and soft-deletes with audit', async () => {
      const created = await http()
        .post('/api/v1/categories')
        .set(bearer(tokenA))
        .send({ name: 'Giyim', slug: `giyim-${run}` })
        .expect(201);
      const id = created.body.data.id as string;
      expect(created.body.data).toMatchObject({
        name: 'Giyim',
        parentId: null,
      });

      const list = await http()
        .get(`/api/v1/categories?search=giyim-${run}`)
        .set(bearer(tokenA))
        .expect(200);
      expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([id]);
      expect(list.body.meta).toMatchObject({ page: 1, per_page: 20, total: 1 });

      await http()
        .patch(`/api/v1/categories/${id}`)
        .set(bearer(tokenA))
        .send({ name: 'Moda' })
        .expect(200);
      await http()
        .delete(`/api/v1/categories/${id}`)
        .set(bearer(tokenA))
        .expect(204);
      await http()
        .get(`/api/v1/categories/${id}`)
        .set(bearer(tokenA))
        .expect(404);

      expect((await auditRows(id)).map((r) => r.action)).toEqual([
        'CREATE',
        'UPDATE',
        'DELETE',
      ]);
      expect((await auditRows(id))[0]).toMatchObject({
        module: 'catalog',
        entity_type: 'Category',
      });
    });

    it('maps a duplicate active slug to 409 CATEGORY_SLUG_TAKEN', async () => {
      const slug = `dup-${run}`;
      await http()
        .post('/api/v1/categories')
        .set(bearer(tokenA))
        .send({ name: 'Bir', slug })
        .expect(201);
      const res = await http()
        .post('/api/v1/categories')
        .set(bearer(tokenA))
        .send({ name: 'İki', slug })
        .expect(409);
      expect(res.body.error.code).toBe('CATEGORY_SLUG_TAKEN');
    });

    it('rejects a cycle (A→B→A) and a self parent', async () => {
      const a = (
        await http()
          .post('/api/v1/categories')
          .set(bearer(tokenA))
          .send({ name: 'A', slug: `cyc-a-${run}` })
          .expect(201)
      ).body.data.id as string;
      const b = (
        await http()
          .post('/api/v1/categories')
          .set(bearer(tokenA))
          .send({ name: 'B', slug: `cyc-b-${run}`, parentId: a })
          .expect(201)
      ).body.data.id as string;
      const c = (
        await http()
          .post('/api/v1/categories')
          .set(bearer(tokenA))
          .send({ name: 'C', slug: `cyc-c-${run}`, parentId: b })
          .expect(201)
      ).body.data.id as string;

      const direct = await http()
        .patch(`/api/v1/categories/${a}`)
        .set(bearer(tokenA))
        .send({ parentId: b })
        .expect(422);
      expect(direct.body.error.code).toBe('CATEGORY_CYCLE');
      const deep = await http()
        .patch(`/api/v1/categories/${a}`)
        .set(bearer(tokenA))
        .send({ parentId: c })
        .expect(422);
      expect(deep.body.error.code).toBe('CATEGORY_CYCLE');
      const self = await http()
        .patch(`/api/v1/categories/${a}`)
        .set(bearer(tokenA))
        .send({ parentId: a })
        .expect(422);
      expect(self.body.error.code).toBe('CATEGORY_CYCLE');

      // Moving to the root is fine.
      await http()
        .patch(`/api/v1/categories/${c}`)
        .set(bearer(tokenA))
        .send({ parentId: null })
        .expect(200);
    });

    it('refuses a soft-deleted parent and deleting a category in use', async () => {
      const parent = (
        await http()
          .post('/api/v1/categories')
          .set(bearer(tokenA))
          .send({ name: 'P', slug: `use-p-${run}` })
          .expect(201)
      ).body.data.id as string;
      await http()
        .post('/api/v1/categories')
        .set(bearer(tokenA))
        .send({ name: 'K', slug: `use-k-${run}`, parentId: parent })
        .expect(201);
      const inUse = await http()
        .delete(`/api/v1/categories/${parent}`)
        .set(bearer(tokenA))
        .expect(409);
      expect(inUse.body.error.code).toBe('CATEGORY_IN_USE');

      const gone = (
        await http()
          .post('/api/v1/categories')
          .set(bearer(tokenA))
          .send({ name: 'G', slug: `use-g-${run}` })
          .expect(201)
      ).body.data.id as string;
      await http()
        .delete(`/api/v1/categories/${gone}`)
        .set(bearer(tokenA))
        .expect(204);
      const res = await http()
        .post('/api/v1/categories')
        .set(bearer(tokenA))
        .send({ name: 'H', slug: `use-h-${run}`, parentId: gone })
        .expect(422);
      expect(res.body.error.code).toBe('CATEGORY_UNAVAILABLE');
    });
  });

  describe('brands', () => {
    it('creates, updates, deletes with audit; duplicate name is 409', async () => {
      const name = `Marka ${run}`;
      const id = (
        await http()
          .post('/api/v1/brands')
          .set(bearer(tokenA))
          .send({ name })
          .expect(201)
      ).body.data.id as string;
      const dup = await http()
        .post('/api/v1/brands')
        .set(bearer(tokenA))
        .send({ name: name.toUpperCase() })
        .expect(409);
      expect(dup.body.error.code).toBe('BRAND_NAME_TAKEN');
      await http()
        .patch(`/api/v1/brands/${id}`)
        .set(bearer(tokenA))
        .send({ name: `${name} 2` })
        .expect(200);
      await http()
        .delete(`/api/v1/brands/${id}`)
        .set(bearer(tokenA))
        .expect(204);
      expect((await auditRows(id)).map((r) => r.action)).toEqual([
        'CREATE',
        'UPDATE',
        'DELETE',
      ]);
    });
  });

  describe('products', () => {
    it('creates with variants, reads, updates, archives and soft-deletes with audit', async () => {
      const brand = (
        await http()
          .post('/api/v1/brands')
          .set(bearer(tokenA))
          .send({ name: `PB ${run}` })
          .expect(201)
      ).body.data.id as string;
      const p = await createProduct(
        tokenA,
        productBody('crud', {
          brandId: brand,
          variants: [
            { sku: sku('crud-1'), barcode: `869${run}1` },
            { sku: sku('crud-2') },
          ],
        }),
      );
      expect(p).toMatchObject({
        companyId: companyX,
        brandId: brand,
        status: 'draft',
      });
      expect(p.variants.map((v) => v.sku).sort()).toEqual(
        [sku('crud-1'), sku('crud-2')].sort(),
      );

      await http()
        .get(`/api/v1/products/${p.id}`)
        .set(bearer(tokenA))
        .expect(200);
      const upd = await http()
        .patch(`/api/v1/products/${p.id}`)
        .set(bearer(tokenA))
        .send({ name: 'Yeni ad', status: 'archived', brandId: null })
        .expect(200);
      expect(upd.body.data).toMatchObject({
        name: 'Yeni ad',
        status: 'archived',
        brandId: null,
      });

      await http()
        .delete(`/api/v1/products/${p.id}`)
        .set(bearer(tokenA))
        .expect(204);
      await http()
        .get(`/api/v1/products/${p.id}`)
        .set(bearer(tokenA))
        .expect(404);
      expect((await auditRows(p.id)).map((r) => r.action)).toEqual([
        'CREATE',
        'UPDATE',
        'DELETE',
      ]);
      expect((await auditRows(p.variants[0].id)).map((r) => r.action)).toEqual([
        'CREATE',
        'DELETE',
      ]);
    });

    it('requires at least one variant', async () => {
      await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send(productBody('none', { variants: [] }))
        .expect(422);
    });

    it('maps duplicate SKU/barcode to 409, including soft-deleted ones', async () => {
      const p = await createProduct(
        tokenA,
        productBody('dup', {
          variants: [
            { sku: sku('dup-1'), barcode: `dup1${run}` },
            { sku: sku('dup-2'), barcode: `dup2${run}` },
          ],
        }),
      );
      const s = await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send(productBody('dup-x', { variants: [{ sku: sku('dup-1') }] }))
        .expect(409);
      expect(s.body.error.code).toBe('SKU_TAKEN');
      const b = await http()
        .post(`/api/v1/products/${p.id}/variants`)
        .set(bearer(tokenA))
        .send({ sku: sku('dup-3'), barcode: `dup1${run}` })
        .expect(409);
      expect(b.body.error.code).toBe('BARCODE_TAKEN');

      // Same SKU twice in one request.
      const inBody = await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send(
          productBody('dup-y', {
            variants: [{ sku: sku('dup-y') }, { sku: sku('dup-y') }],
          }),
        )
        .expect(409);
      expect(inBody.body.error.code).toBe('SKU_TAKEN');

      // Soft-deleted variant: its SKU and barcode stay reserved.
      const v2 = p.variants.find((v) => v.sku === sku('dup-2'));
      await http()
        .delete(`/api/v1/products/${p.id}/variants/${v2?.id}`)
        .set(bearer(tokenA))
        .expect(204);
      const reuse = await http()
        .post(`/api/v1/products/${p.id}/variants`)
        .set(bearer(tokenA))
        .send({ sku: sku('dup-2') })
        .expect(409);
      expect(reuse.body.error.code).toBe('SKU_TAKEN');
      const reuseBarcode = await http()
        .post(`/api/v1/products/${p.id}/variants`)
        .set(bearer(tokenA))
        .send({ sku: sku('dup-4'), barcode: `dup2${run}` })
        .expect(409);
      expect(reuseBarcode.body.error.code).toBe('BARCODE_TAKEN');
      const upd = await http()
        .patch(
          `/api/v1/products/${p.id}/variants/${p.variants.find((v) => v.sku === sku('dup-1'))?.id}`,
        )
        .set(bearer(tokenA))
        .send({ sku: sku('dup-2') })
        .expect(409);
      expect(upd.body.error.code).toBe('SKU_TAKEN');
    });

    it('adds, updates and soft-deletes variants; the last one cannot go', async () => {
      const p = await createProduct(tokenA, productBody('var'));
      const added = await http()
        .post(`/api/v1/products/${p.id}/variants`)
        .set(bearer(tokenA))
        .send({ sku: sku('var-2'), barcode: `var${run}` })
        .expect(201);
      const vid = added.body.data.id as string;
      const upd = await http()
        .patch(`/api/v1/products/${p.id}/variants/${vid}`)
        .set(bearer(tokenA))
        .send({ barcode: null })
        .expect(200);
      expect(upd.body.data.barcode).toBeNull();
      await http()
        .delete(`/api/v1/products/${p.id}/variants/${vid}`)
        .set(bearer(tokenA))
        .expect(204);
      const last = await http()
        .delete(`/api/v1/products/${p.id}/variants/${p.variants[0].id}`)
        .set(bearer(tokenA))
        .expect(409);
      expect(last.body.error.code).toBe('LAST_VARIANT');
      expect((await auditRows(vid)).map((r) => r.action)).toEqual([
        'CREATE',
        'UPDATE',
        'DELETE',
      ]);
      const got = await http()
        .get(`/api/v1/products/${p.id}`)
        .set(bearer(tokenA))
        .expect(200);
      expect(got.body.data.variants.map((v: Variant) => v.id)).toEqual([
        p.variants[0].id,
      ]);
    });

    it('refuses a soft-deleted or missing category/brand', async () => {
      const cat = (
        await http()
          .post('/api/v1/categories')
          .set(bearer(tokenA))
          .send({ name: 'Silinen', slug: `del-${run}` })
          .expect(201)
      ).body.data.id as string;
      const brand = (
        await http()
          .post('/api/v1/brands')
          .set(bearer(tokenA))
          .send({ name: `Silinen ${run}` })
          .expect(201)
      ).body.data.id as string;
      await http()
        .delete(`/api/v1/categories/${cat}`)
        .set(bearer(tokenA))
        .expect(204);
      await http()
        .delete(`/api/v1/brands/${brand}`)
        .set(bearer(tokenA))
        .expect(204);

      const c = await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send(productBody('delcat', { categoryId: cat }))
        .expect(422);
      expect(c.body.error.code).toBe('CATEGORY_UNAVAILABLE');
      const b = await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send(productBody('delbrand', { brandId: brand }))
        .expect(422);
      expect(b.body.error.code).toBe('BRAND_UNAVAILABLE');

      const p = await createProduct(tokenA, productBody('delupd'));
      const u = await http()
        .patch(`/api/v1/products/${p.id}`)
        .set(bearer(tokenA))
        .send({ categoryId: cat })
        .expect(422);
      expect(u.body.error.code).toBe('CATEGORY_UNAVAILABLE');
      await http()
        .patch(`/api/v1/products/${p.id}`)
        .set(bearer(tokenA))
        .send({ brandId: randomUUID() })
        .expect(422);
    });

    it('refuses deleting a category or brand used by a product', async () => {
      const cat = (
        await http()
          .post('/api/v1/categories')
          .set(bearer(tokenA))
          .send({ name: 'Kullanılan', slug: `used-${run}` })
          .expect(201)
      ).body.data.id as string;
      const brand = (
        await http()
          .post('/api/v1/brands')
          .set(bearer(tokenA))
          .send({ name: `Kullanılan ${run}` })
          .expect(201)
      ).body.data.id as string;
      await createProduct(
        tokenA,
        productBody('used', { categoryId: cat, brandId: brand }),
      );
      expect(
        (
          await http()
            .delete(`/api/v1/categories/${cat}`)
            .set(bearer(tokenA))
            .expect(409)
        ).body.error.code,
      ).toBe('CATEGORY_IN_USE');
      expect(
        (
          await http()
            .delete(`/api/v1/brands/${brand}`)
            .set(bearer(tokenA))
            .expect(409)
        ).body.error.code,
      ).toBe('BRAND_IN_USE');
    });

    it('filters and paginates', async () => {
      const cat = (
        await http()
          .post('/api/v1/categories')
          .set(bearer(tokenA))
          .send({ name: 'Filtre', slug: `flt-${run}` })
          .expect(201)
      ).body.data.id as string;
      const tag = `flt${run}`;
      const made: Product[] = [];
      for (let i = 0; i < 5; i++) {
        made.push(
          await createProduct(tokenA, {
            companyId: i < 3 ? companyX : companyY,
            name: `${tag} ${i}`,
            categoryId: i % 2 === 0 ? cat : undefined,
            status: i === 4 ? 'active' : 'draft',
            variants: [{ sku: sku(`flt-${i}`), barcode: `b${tag}${i}` }],
          }),
        );
      }
      const q = (s: string) =>
        http().get(`/api/v1/products?${s}`).set(bearer(tokenA)).expect(200);

      const page1 = await q(`search=${tag}&per_page=2&page=1`);
      const page3 = await q(`search=${tag}&per_page=2&page=3`);
      expect(page1.body.meta).toEqual({ page: 1, per_page: 2, total: 5 });
      expect(page1.body.data).toHaveLength(2);
      expect(page3.body.data).toHaveLength(1);

      expect(
        (await q(`search=${tag}&company_id=${companyY}`)).body.meta.total,
      ).toBe(2);
      expect((await q(`search=${tag}&status=active`)).body.data[0].id).toBe(
        made[4].id,
      );
      expect(
        (await q(`search=${tag}&category_id=${cat}`)).body.meta.total,
      ).toBe(3);
      expect((await q(`search=${sku('flt-3')}`)).body.data[0].id).toBe(
        made[3].id,
      );
      expect((await q(`search=b${tag}1`)).body.data[0].id).toBe(made[1].id);

      // Soft-deleted products are not listed.
      await http()
        .delete(`/api/v1/products/${made[0].id}`)
        .set(bearer(tokenA))
        .expect(204);
      expect((await q(`search=${tag}`)).body.meta.total).toBe(4);
    });
  });

  describe('access', () => {
    it('tenant B cannot read, update or delete tenant A rows (404)', async () => {
      const p = await createProduct(tokenA, productBody('iso'));
      const cat = (
        await http()
          .post('/api/v1/categories')
          .set(bearer(tokenA))
          .send({ name: 'İzole', slug: `iso-${run}` })
          .expect(201)
      ).body.data.id as string;
      const brand = (
        await http()
          .post('/api/v1/brands')
          .set(bearer(tokenA))
          .send({ name: `İzole ${run}` })
          .expect(201)
      ).body.data.id as string;

      for (const path of [
        `/api/v1/products/${p.id}`,
        `/api/v1/categories/${cat}`,
        `/api/v1/brands/${brand}`,
      ]) {
        await http().get(path).set(bearer(tokenB)).expect(404);
        await http()
          .patch(path)
          .set(bearer(tokenB))
          .send({ name: 'Ele geçir' })
          .expect(404);
        await http().delete(path).set(bearer(tokenB)).expect(404);
      }
      await http()
        .post(`/api/v1/products/${p.id}/variants`)
        .set(bearer(tokenB))
        .send({ sku: sku('iso-b') })
        .expect(404);
      await http()
        .delete(`/api/v1/products/${p.id}/variants/${p.variants[0].id}`)
        .set(bearer(tokenB))
        .expect(404);
      // Tenant B cannot create a product in tenant A's company.
      await http()
        .post('/api/v1/products')
        .set(bearer(tokenB))
        .send(productBody('iso-c'))
        .expect(404);
      const listB = await http()
        .get(`/api/v1/products?search=${run}`)
        .set(bearer(tokenB))
        .expect(200);
      expect(listB.body.meta.total).toBe(0);
    });

    it('a role only on company X gives no access to company Y products', async () => {
      const inX = await createProduct(tokenA, productBody('acc-x'));
      const inY = await createProduct(
        tokenA,
        productBody('acc-y', { companyId: companyY }),
      );
      const ops = await memberWith('ops', 'operations', [companyX]);

      await http()
        .get(`/api/v1/products/${inX.id}`)
        .set(bearer(ops))
        .expect(200);
      await http()
        .get(`/api/v1/products/${inY.id}`)
        .set(bearer(ops))
        .expect(404);
      await http()
        .patch(`/api/v1/products/${inY.id}`)
        .set(bearer(ops))
        .send({ name: 'x' })
        .expect(404);
      await http()
        .delete(`/api/v1/products/${inY.id}`)
        .set(bearer(ops))
        .expect(404);
      await http()
        .post(`/api/v1/products/${inY.id}/variants`)
        .set(bearer(ops))
        .send({ sku: sku('acc-y2') })
        .expect(404);
      await http()
        .post('/api/v1/products')
        .set(bearer(ops))
        .send(productBody('acc-y3', { companyId: companyY }))
        .expect(404);
      await createProduct(ops, productBody('acc-x2'));

      const list = await http()
        .get(`/api/v1/products?search=acc-&per_page=100`)
        .set(bearer(ops))
        .expect(200);
      const companies = new Set(
        list.body.data.map((p: Product) => p.companyId),
      );
      expect([...companies]).toEqual([companyX]);
      const filtered = await http()
        .get(`/api/v1/products?company_id=${companyY}`)
        .set(bearer(ops))
        .expect(200);
      expect(filtered.body.meta.total).toBe(0);

      // Tenant-wide catalog data: a company role can read, not write.
      await http().get('/api/v1/categories').set(bearer(ops)).expect(200);
      await http()
        .post('/api/v1/categories')
        .set(bearer(ops))
        .send({ name: 'Ops', slug: `ops-${run}` })
        .expect(403);
      await http()
        .post('/api/v1/brands')
        .set(bearer(ops))
        .send({ name: `Ops ${run}` })
        .expect(403);
    });

    it('a viewer reads but cannot write', async () => {
      const p = await createProduct(tokenA, productBody('view'));
      const viewer = await memberWith('viewer', 'viewer', [companyX]);
      await http()
        .get(`/api/v1/products/${p.id}`)
        .set(bearer(viewer))
        .expect(200);
      await http()
        .post('/api/v1/products')
        .set(bearer(viewer))
        .send(productBody('view-2'))
        .expect(403);
      await http()
        .patch(`/api/v1/products/${p.id}`)
        .set(bearer(viewer))
        .send({ name: 'x' })
        .expect(403);
      await http()
        .delete(`/api/v1/products/${p.id}`)
        .set(bearer(viewer))
        .expect(403);
      await http()
        .post(`/api/v1/products/${p.id}/variants`)
        .set(bearer(viewer))
        .send({ sku: sku('view-3') })
        .expect(403);
    });

    it('companies:all (admin) sees every company', async () => {
      const inX = await createProduct(tokenA, productBody('all-x'));
      const inY = await createProduct(
        tokenA,
        productBody('all-y', { companyId: companyY }),
      );
      const admin = await memberWith('admin', 'admin');
      const list = await http()
        .get(`/api/v1/products?search=all-&per_page=100`)
        .set(bearer(admin))
        .expect(200);
      const ids = list.body.data.map((p: Product) => p.id);
      expect(ids).toEqual(expect.arrayContaining([inX.id, inY.id]));
      await http()
        .patch(`/api/v1/products/${inY.id}`)
        .set(bearer(admin))
        .send({ name: 'Admin' })
        .expect(200);
      await http()
        .post('/api/v1/brands')
        .set(bearer(admin))
        .send({ name: `Admin ${run}` })
        .expect(201);
    });

    it('rejects companyId in a product PATCH (422 validation): products cannot change company', async () => {
      const p = await createProduct(tokenA, productBody('move'));
      await http()
        .patch(`/api/v1/products/${p.id}`)
        .set(bearer(tokenA))
        .send({ companyId: companyY })
        .expect(422);
      const after = await http()
        .get(`/api/v1/products/${p.id}`)
        .set(bearer(tokenA))
        .expect(200);
      expect(after.body.data.companyId).toBe(companyX);
    });

    it('a variant id of another product is 404 on PATCH and DELETE', async () => {
      const p = await createProduct(
        tokenA,
        productBody('vown', {
          variants: [{ sku: sku('vown-1') }, { sku: sku('vown-2') }],
        }),
      );
      const other = await createProduct(tokenA, productBody('vother'));
      const foreign = other.variants[0].id;
      await http()
        .patch(`/api/v1/products/${p.id}/variants/${foreign}`)
        .set(bearer(tokenA))
        .send({ barcode: `BC-${run}` })
        .expect(404);
      await http()
        .delete(`/api/v1/products/${p.id}/variants/${foreign}`)
        .set(bearer(tokenA))
        .expect(404);
      // Tenant B cannot PATCH a tenant A variant either.
      await http()
        .patch(`/api/v1/products/${other.id}/variants/${foreign}`)
        .set(bearer(tokenB))
        .send({ barcode: `BC2-${run}` })
        .expect(404);
      const still = await http()
        .get(`/api/v1/products/${other.id}`)
        .set(bearer(tokenA))
        .expect(200);
      expect(still.body.data.variants).toEqual([
        expect.objectContaining({ id: foreign, barcode: null }),
      ]);
    });

    it("refuses another tenant's category or brand on create and update (422)", async () => {
      const catB = (
        await http()
          .post('/api/v1/categories')
          .set(bearer(tokenB))
          .send({ name: 'B kategori', slug: `b-cat-${run}` })
          .expect(201)
      ).body.data.id as string;
      const brandB = (
        await http()
          .post('/api/v1/brands')
          .set(bearer(tokenB))
          .send({ name: `B marka ${run}` })
          .expect(201)
      ).body.data.id as string;

      for (const [field, id, code] of [
        ['categoryId', catB, 'CATEGORY_UNAVAILABLE'],
        ['brandId', brandB, 'BRAND_UNAVAILABLE'],
      ] as const) {
        const created = await http()
          .post('/api/v1/products')
          .set(bearer(tokenA))
          .send(productBody(`xt-${field}`, { [field]: id }))
          .expect(422);
        expect(created.body.error.code).toBe(code);
      }
      const p = await createProduct(tokenA, productBody('xt-upd'));
      for (const [field, id, code] of [
        ['categoryId', catB, 'CATEGORY_UNAVAILABLE'],
        ['brandId', brandB, 'BRAND_UNAVAILABLE'],
      ] as const) {
        const res = await http()
          .patch(`/api/v1/products/${p.id}`)
          .set(bearer(tokenA))
          .send({ [field]: id })
          .expect(422);
        expect(res.body.error.code).toBe(code);
      }
      // A category of tenant B cannot be a parent in tenant A either.
      await http()
        .post('/api/v1/categories')
        .set(bearer(tokenA))
        .send({ name: 'Alt', slug: `xt-sub-${run}`, parentId: catB })
        .expect(422);
    });

    it('freezes the catalog of an inactive company: reads work, writes are 409 COMPANY_INACTIVE', async () => {
      const companyZ = await createCompany(tokenA, `Z ${run}`);
      const p = await createProduct(
        tokenA,
        productBody('frz', {
          companyId: companyZ,
          variants: [{ sku: sku('frz-1') }, { sku: sku('frz-2') }],
        }),
      );
      const ops = await memberWith('frz-ops', 'operations', [companyZ]);
      await http()
        .post(`/api/v1/companies/${companyZ}/deactivate`)
        .set(bearer(tokenA))
        .expect(200);

      const inactive = (res: request.Response) =>
        expect(res.body.error.code).toBe('COMPANY_INACTIVE');
      for (const token of [tokenA, ops]) {
        await http()
          .get(`/api/v1/products/${p.id}`)
          .set(bearer(token))
          .expect(200);
        inactive(
          await http()
            .post('/api/v1/products')
            .set(bearer(token))
            .send(
              productBody(`frz-new-${token === ops}`, { companyId: companyZ }),
            )
            .expect(409),
        );
        inactive(
          await http()
            .patch(`/api/v1/products/${p.id}`)
            .set(bearer(token))
            .send({ name: 'Donmuş' })
            .expect(409),
        );
        inactive(
          await http()
            .post(`/api/v1/products/${p.id}/variants`)
            .set(bearer(token))
            .send({ sku: sku(`frz-3-${token === ops}`) })
            .expect(409),
        );
        inactive(
          await http()
            .patch(`/api/v1/products/${p.id}/variants/${p.variants[0].id}`)
            .set(bearer(token))
            .send({ barcode: `FRZ-${run}` })
            .expect(409),
        );
        inactive(
          await http()
            .delete(`/api/v1/products/${p.id}/variants/${p.variants[1].id}`)
            .set(bearer(token))
            .expect(409),
        );
        inactive(
          await http()
            .delete(`/api/v1/products/${p.id}`)
            .set(bearer(token))
            .expect(409),
        );
      }
      // A viewer still gets 403 first; no role still gets 404 (no company state leak).
      const viewer = await memberWith('frz-view', 'viewer', [companyZ]);
      await http()
        .patch(`/api/v1/products/${p.id}`)
        .set(bearer(viewer))
        .send({ name: 'x' })
        .expect(403);
      await http()
        .patch(`/api/v1/products/${p.id}`)
        .set(bearer(tokenB))
        .send({ name: 'x' })
        .expect(404);
      // Same tenant, role only in another company: still 404.
      const outsider = await memberWith('frz-none', 'operations', [companyX]);
      await http()
        .patch(`/api/v1/products/${p.id}`)
        .set(bearer(outsider))
        .send({ name: 'x' })
        .expect(404);

      const unchanged = await http()
        .get(`/api/v1/products/${p.id}`)
        .set(bearer(tokenA))
        .expect(200);
      expect(unchanged.body.data.name).toBe(p.name);
      expect(unchanged.body.data.variants).toHaveLength(2);
      expect(await auditRows(p.id)).toHaveLength(1);

      // Reactivated: writes work again.
      await http()
        .post(`/api/v1/companies/${companyZ}/activate`)
        .set(bearer(tokenA))
        .expect(200);
      await http()
        .patch(`/api/v1/products/${p.id}`)
        .set(bearer(ops))
        .send({ name: 'Çözüldü' })
        .expect(200);
    });
  });
});
