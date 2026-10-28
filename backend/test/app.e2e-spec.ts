import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import {
  PRISMA,
  type TenantPrismaClient,
} from './../src/database/prisma.service.js';
import { setupApp } from './../src/setup-app.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import { TenantContextMissingError } from './../src/tenancy/tenant.errors.js';
import { purgeTenants } from './helpers.js';

const PASSWORD = 'Sifre-12345';

describe('API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: TenantPrismaClient;
  const run = randomUUID().slice(0, 8);
  const tenants = {
    a: { slug: `a-${run}`, email: `a-${run}@test.local` },
    b: { slug: `b-${run}`, email: `b-${run}@test.local` },
  };
  const tokens: Record<
    'a' | 'b',
    { accessToken: string; refreshToken: string }
  > = {} as never;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PRISMA);

    for (const key of ['a', 'b'] as const) {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({
          tenantName: `Mağaza ${key}`,
          tenantSlug: tenants[key].slug,
          name: `Sahip ${key}`,
          email: tenants[key].email,
          password: PASSWORD,
        })
        .expect(201);
      tokens[key] = res.body.data;
    }
  });

  afterAll(async () => {
    await purgeTenants(prisma, [tenants.a.slug, tenants.b.slug]);
    await app.close();
  });

  it('GET /health is public', () =>
    http()
      .get('/api/v1/health')
      .expect(200)
      .expect({ data: { status: 'ok', database: 'up' } }));

  describe('tenant isolation', () => {
    it('blocks queries with no tenant context', async () => {
      await expect(prisma.user.findMany()).rejects.toBeInstanceOf(
        TenantContextMissingError,
      );
    });

    it('a tenant only sees its own users, even with an empty where', async () => {
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.a.accessToken}`)
        .expect(200);
      const tenantA = me.body.data.tenantId as string;

      const users = await TenantContext.run(tenantA, () =>
        prisma.user.findMany({ select: { email: true } }),
      );
      expect(users).toEqual([{ email: tenants.a.email }]);
    });

    it("cannot read another tenant's row by id", async () => {
      const b = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.b.accessToken}`)
        .expect(200);
      const a = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.a.accessToken}`)
        .expect(200);

      const leaked = await TenantContext.run(a.body.data.tenantId, () =>
        prisma.user.findUnique({ where: { id: b.body.data.id } }),
      );
      expect(leaked).toBeNull();
    });

    it("database rejects linking a role to another tenant's user", async () => {
      const a = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.a.accessToken}`);
      const b = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.b.accessToken}`);

      await expect(
        TenantContext.run(a.body.data.tenantId, async () => {
          const role = await prisma.role.findFirstOrThrow();
          return prisma.userRole.create({
            data: {
              tenantId: a.body.data.tenantId,
              userId: b.body.data.id,
              roleId: role.id,
            },
          });
        }),
      ).rejects.toThrow(/Foreign key|foreign key/);
    });
  });

  describe('auth', () => {
    it('rejects requests without a token', () =>
      http()
        .get('/api/v1/auth/me')
        .expect(401)
        .expect((res) => expect(res.body.error.code).toBe('UNAUTHORIZED')));

    it('returns 422 with field details on invalid input', () =>
      http()
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email' })
        .expect(422)
        .expect((res) => {
          expect(res.body.error.code).toBe('VALIDATION_ERROR');
          expect(res.body.error.details.length).toBeGreaterThan(0);
        }));

    it('returns 409 for a duplicate email', () =>
      http()
        .post('/api/v1/auth/register')
        .send({
          tenantName: 'Başka',
          tenantSlug: `c-${run}`,
          name: 'Başka Sahip',
          email: tenants.a.email,
          password: PASSWORD,
        })
        .expect(409));

    it('does not leave a tenant behind when registration fails', async () => {
      const orphan = await TenantContext.runAsSystem(() =>
        prisma.tenant.findUnique({ where: { slug: `c-${run}` } }),
      );
      expect(orphan).toBeNull();
    });

    it('logs in and returns owner permissions', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: tenants.a.email.toUpperCase(), password: PASSWORD })
        .expect(200);
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${res.body.data.accessToken}`)
        .expect(200);
      expect(me.body.data).toMatchObject({
        email: tenants.a.email,
        permissions: ['*'],
      });
    });

    it('rejects a wrong password', () =>
      http()
        .post('/api/v1/auth/login')
        .send({ email: tenants.a.email, password: 'yanlis-sifre' })
        .expect(401)
        .expect((res) =>
          expect(res.body.error.code).toBe('INVALID_CREDENTIALS'),
        ));

    it('rotates refresh tokens and kills all sessions on reuse', async () => {
      const first = tokens.b.refreshToken;
      const rotated = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first })
        .expect(200);
      const second = rotated.body.data.refreshToken as string;
      expect(second).not.toBe(first);

      // Reusing the old token is treated as theft…
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first })
        .expect(401);
      // …so the newer token is revoked too.
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: second })
        .expect(401);
    });

    it('logout revokes the refresh token', async () => {
      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email: tenants.a.email, password: PASSWORD })
        .expect(200);
      const { accessToken, refreshToken } = login.body.data;

      await http()
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(204);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });
});
