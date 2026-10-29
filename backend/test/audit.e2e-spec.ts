import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  PRISMA,
  type TenantPrismaClient,
} from './../src/database/prisma.service.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import { TenantViolationError } from './../src/tenancy/tenant.errors.js';
import {
  createTestApp,
  ownerPool,
  purgeTenants,
  seedMember,
} from './helpers.js';

const PASSWORD = 'Sifre-12345';
const UA = 'audit-e2e/1.0';

interface Session {
  accessToken: string;
  refreshToken: string;
}

interface AuditRow {
  id: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

describe('Audit log (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: TenantPrismaClient;
  const run = randomUUID().slice(0, 8);
  const a = { slug: `audit-a-${run}`, email: `audit-a-${run}@test.local` };
  const b = { slug: `audit-b-${run}`, email: `audit-b-${run}@test.local` };
  const viewerEmail = `audit-viewer-${run}@test.local`;
  let ownerA: Session;
  let ownerB: Session;
  let viewerA: Session;
  let tenantA: string;
  let userA: string;

  const http = () => request(app.getHttpServer());
  const auth = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });

  const register = async (t: typeof a) =>
    (
      await http()
        .post('/api/v1/auth/register')
        .set('User-Agent', UA)
        .send({
          tenantName: `Mağaza ${t.slug}`,
          tenantSlug: t.slug,
          name: 'Sahip Kişi',
          email: t.email,
          password: PASSWORD,
        })
        .expect(201)
    ).body.data as Session;

  const login = async (email: string) =>
    (
      await http()
        .post('/api/v1/auth/login')
        .set('User-Agent', UA)
        .send({ email, password: PASSWORD })
        .expect(200)
    ).body.data as Session;

  const listAll = async (s: Session, query = '') =>
    (
      await http()
        .get(`/api/v1/audit-logs?per_page=100${query}`)
        .set(auth(s))
        .expect(200)
    ).body as { data: AuditRow[]; meta: Record<string, number> };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PRISMA);

    ownerA = await register(a);
    ownerB = await register(b);

    const me = await http().get('/api/v1/auth/me').set(auth(ownerA));
    tenantA = me.body.data.tenantId;
    userA = me.body.data.id;

    // A user in tenant A whose role lacks audit:read.
    const passwordHash = await hash(PASSWORD);
    // Users are global: the user and its membership are seeded outside the
    // tenant extension; the custom (key-less) tenant role is still tenant data.
    const role = await TenantContext.run(tenantA, () =>
      prisma.role.create({
        data: {
          tenantId: tenantA,
          name: 'viewer',
          scope: 'tenant',
          permissions: ['products:read'],
        },
      }),
    );
    await seedMember({
      email: viewerEmail,
      name: 'İzleyici',
      passwordHash,
      memberships: [{ tenantId: tenantA, roleId: role.id }],
    });
    viewerA = await login(viewerEmail);
  });

  afterAll(async () => {
    await purgeTenants([a.slug, b.slug]);
    await app.close();
  });

  describe('recording', () => {
    it('records tenant and owner creation on register, without secrets', async () => {
      const { data } = await listAll(ownerA, '&action=CREATE');
      const tenant = data.find((r) => r.entityType === 'Tenant');
      const user = data.find((r) => r.entityType === 'User');

      expect(tenant).toMatchObject({
        module: 'tenants',
        entityId: tenantA,
        actorUserId: userA,
        after: { slug: a.slug },
      });
      expect(user).toMatchObject({ module: 'auth', entityId: userA });
      expect(JSON.stringify(data)).not.toContain(PASSWORD);
      expect(JSON.stringify(data)).not.toMatch(/argon2/);
    });

    it('records LOGIN with actor, IP and user agent', async () => {
      await login(a.email);
      const { data } = await listAll(
        ownerA,
        `&action=LOGIN&entity_id=${userA}`,
      );
      expect(data[0]).toMatchObject({
        action: 'LOGIN',
        actorUserId: userA,
        userAgent: UA,
      });
      expect(data[0].ipAddress).toMatch(/127\.0\.0\.1|::1/);
    });

    it('records LOGIN_FAILED for a known email, with no actor and no password', async () => {
      await http()
        .post('/api/v1/auth/login')
        .send({ email: a.email, password: 'yanlis-sifre-123' })
        .expect(401);
      // Written in the background: poll briefly.
      let data: AuditRow[] = [];
      for (let i = 0; i < 50 && data.length === 0; i++) {
        data = (await listAll(ownerA, '&action=LOGIN_FAILED')).data;
        if (data.length === 0) await new Promise((r) => setTimeout(r, 50));
      }
      expect(data[0]).toMatchObject({
        entityId: userA,
        actorUserId: null,
        after: { reason: 'invalid_password' },
      });
      expect(JSON.stringify(data)).not.toContain('yanlis-sifre-123');
    });

    it('records LOGOUT and never stores the refresh token', async () => {
      const session = await login(a.email);
      await http()
        .post('/api/v1/auth/logout')
        .set(auth(session))
        .send({ refreshToken: session.refreshToken })
        .expect(204);
      const { data } = await listAll(ownerA);
      expect(data.some((r) => r.action === 'LOGOUT')).toBe(true);
      expect(JSON.stringify(data)).not.toContain(session.refreshToken);
      expect(JSON.stringify(data)).not.toContain(session.accessToken);
    });

    it('records TOKEN_REUSE_DETECTED', async () => {
      const session = await login(a.email);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(200);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      const { data } = await listAll(ownerA, '&action=TOKEN_REUSE_DETECTED');
      expect(data[0]).toMatchObject({ entityId: userA, actorUserId: null });
    });
  });

  describe('reading', () => {
    it('paginates newest first', async () => {
      const page1 = (
        await http()
          .get('/api/v1/audit-logs?per_page=2&page=1')
          .set(auth(ownerA))
          .expect(200)
      ).body;
      const page2 = (
        await http()
          .get('/api/v1/audit-logs?per_page=2&page=2')
          .set(auth(ownerA))
          .expect(200)
      ).body;
      expect(page1.data).toHaveLength(2);
      expect(page1.meta).toMatchObject({ page: 1, per_page: 2 });
      expect(page1.meta.total).toBeGreaterThan(2);
      expect(page1.data[0].createdAt >= page1.data[1].createdAt).toBe(true);
      expect(page2.data[0].id).not.toBe(page1.data[0].id);
    });

    it('filters by module and date range', async () => {
      const future = new Date(Date.now() + 3_600_000).toISOString();
      expect(
        (await listAll(ownerA, '&module=tenants')).data.every(
          (r) => r.module === 'tenants',
        ),
      ).toBe(true);
      expect(
        (await listAll(ownerA, `&from=${encodeURIComponent(future)}`)).data,
      ).toEqual([]);
    });

    it('does not expose tenant_id', async () => {
      const { data } = await listAll(ownerA);
      expect(data[0]).not.toHaveProperty('tenantId');
    });

    it('rejects invalid query parameters with 422', async () => {
      await http()
        .get('/api/v1/audit-logs?per_page=1000')
        .set(auth(ownerA))
        .expect(422);
      await http()
        .get('/api/v1/audit-logs?action=HACK')
        .set(auth(ownerA))
        .expect(422);
      await http()
        .get('/api/v1/audit-logs?from=dun')
        .set(auth(ownerA))
        .expect(422);
      await http()
        .get('/api/v1/audit-logs/not-a-uuid')
        .set(auth(ownerA))
        .expect(422);
    });
  });

  describe('tenant isolation', () => {
    it('each tenant sees only its own history', async () => {
      const ofA = await listAll(ownerA);
      const ofB = await listAll(ownerB);
      const idsA = new Set(ofA.data.map((r) => r.id));
      expect(ofB.data.length).toBeGreaterThan(0);
      expect(ofB.data.some((r) => idsA.has(r.id))).toBe(false);
      expect(ofB.data.some((r) => r.entityId === userA)).toBe(false);
    });

    it("returns 404 for another tenant's record id", async () => {
      const { data } = await listAll(ownerA);
      await http()
        .get(`/api/v1/audit-logs/${data[0].id}`)
        .set(auth(ownerB))
        .expect(404);
      await http()
        .get(`/api/v1/audit-logs/${data[0].id}`)
        .set(auth(ownerA))
        .expect(200);
    });
  });

  describe('authorization', () => {
    it('requires authentication', async () => {
      await http().get('/api/v1/audit-logs').expect(401);
    });

    it('requires audit:read', async () => {
      const res = await http()
        .get('/api/v1/audit-logs')
        .set(auth(viewerA))
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('offers no write endpoints', async () => {
      const { data } = await listAll(ownerA);
      const url = `/api/v1/audit-logs/${data[0].id}`;
      await http().delete(url).set(auth(ownerA)).expect(404);
      await http().patch(url).set(auth(ownerA)).send({}).expect(404);
      await http()
        .post('/api/v1/audit-logs')
        .set(auth(ownerA))
        .send({})
        .expect(404);
    });
  });

  describe('immutability', () => {
    it('Prisma refuses update and delete, even in system context', async () => {
      const { data } = await listAll(ownerA);
      const id = data[0].id;
      await expect(
        TenantContext.run(tenantA, () =>
          prisma.auditLog.update({ where: { id }, data: { module: 'x' } }),
        ),
      ).rejects.toBeInstanceOf(TenantViolationError);
      await expect(
        TenantContext.runAsSystem(() => prisma.auditLog.deleteMany({})),
      ).rejects.toBeInstanceOf(TenantViolationError);
    });

    it('the app role has no UPDATE/DELETE privilege on audit_logs', async () => {
      await expect(
        TenantContext.runAsSystem(
          () =>
            prisma.$executeRaw`UPDATE audit_logs SET module = 'x' WHERE tenant_id = ${tenantA}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        TenantContext.runAsSystem(
          () =>
            prisma.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${tenantA}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('the trigger rejects UPDATE/DELETE even for the table owner', async () => {
      const pool = ownerPool();
      try {
        await expect(
          pool.query(
            "UPDATE audit_logs SET module = 'x' WHERE tenant_id = $1",
            [tenantA],
          ),
        ).rejects.toThrow(/append-only/);
        await expect(
          pool.query('DELETE FROM audit_logs WHERE tenant_id = $1', [tenantA]),
        ).rejects.toThrow(/append-only/);
      } finally {
        await pool.end();
      }
    });
  });
});
