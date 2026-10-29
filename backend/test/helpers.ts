import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import pg from 'pg';
import { AppModule } from './../src/app.module.js';
import {
  AUTH_RATE_LIMITS,
  type AuthRateLimits,
  DEFAULT_AUTH_RATE_LIMITS,
} from './../src/rate-limit/rate-limit.config.js';
import { loadSecurityConfig } from './../src/config/security.config.js';
import { setupApp } from './../src/setup-app.js';

config({ path: '../.env', quiet: true });

/** Connection as the least-privileged application role, exactly like the running app. */
export function appPool(): pg.Pool {
  return new pg.Pool({ connectionString: required('DATABASE_URL'), max: 2 });
}

/** Connection as the schema owner. Test cleanup only: the app role cannot purge audit logs. */
export function ownerPool(): pg.Pool {
  return new pg.Pool({
    connectionString: required('MIGRATION_DATABASE_URL'),
    max: 2,
  });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Removes test tenants and everything they own, plus users left without any
 * membership. audit_logs is append-only, so its rows are removed by the table
 * owner under the purge flag the trigger allows.
 */
export async function purgeTenants(slugs: string[]): Promise<void> {
  const pool = ownerPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM tenants WHERE slug = ANY($1)',
      [slugs],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      const users = await client.query<{ id: string }>(
        `SELECT user_id AS id FROM tenant_memberships WHERE tenant_id = ANY($1)
         UNION SELECT id FROM users WHERE tenant_id = ANY($1)`,
        [ids],
      );
      await client.query("SET LOCAL app.allow_audit_purge = 'on'");
      for (const table of [
        'audit_logs',
        'invitations',
        'user_company_roles',
        'user_roles',
        'refresh_tokens',
        'tenant_memberships',
        'product_variants',
        'products',
        'categories',
        'brands',
        'companies',
        'roles',
      ]) {
        await client.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1)`, [
          ids,
        ]);
      }
      await client.query(
        `DELETE FROM users u WHERE u.id = ANY($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.user_id = u.id)`,
        [users.rows.map((r) => r.id)],
      );
      await client.query('DELETE FROM tenants WHERE id = ANY($1)', [ids]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

/** Decodes (without verifying) the access token's claims. */
export function claims(accessToken: string): {
  sub: string;
  tid: string;
  perms: string[];
  ver?: number;
} {
  return JSON.parse(
    Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'),
  );
}

/**
 * Test fixture: a global user plus an active (or inactive) membership in each
 * tenant, with the given role id per tenant. Runs as the schema owner.
 */
export async function seedMember(input: {
  email: string;
  name: string;
  passwordHash: string;
  memberships: {
    tenantId: string;
    roleId?: string;
    status?: 'active' | 'inactive';
  }[];
  lastTenantId?: string;
}): Promise<string> {
  const pool = ownerPool();
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (id, name, email, password_hash, last_tenant_id, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now()) RETURNING id`,
      [input.name, input.email, input.passwordHash, input.lastTenantId ?? null],
    );
    const userId = rows[0].id;
    for (const m of input.memberships) {
      await pool.query(
        `INSERT INTO tenant_memberships (tenant_id, user_id, status, deactivated_at, updated_at)
         VALUES ($1, $2, $3::membership_status, CASE WHEN $3 = 'inactive' THEN now() END, now())`,
        [m.tenantId, userId, m.status ?? 'active'],
      );
      if (m.roleId) {
        await pool.query(
          `INSERT INTO user_roles (tenant_id, user_id, role_id, updated_at) VALUES ($1, $2, $3, now())`,
          [m.tenantId, userId, m.roleId],
        );
      }
    }
    return userId;
  } finally {
    await pool.end();
  }
}

/** Id of a tenant's system role, e.g. 'admin'. */
export async function systemRoleId(
  tenantId: string,
  key: string,
): Promise<string> {
  const pool = ownerPool();
  try {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM roles WHERE tenant_id = $1 AND key = $2',
      [tenantId, key],
    );
    if (!rows[0]) throw new Error(`no ${key} role`);
    return rows[0].id;
  } finally {
    await pool.end();
  }
}

/** Effectively unlimited, so suites that log in many times are not throttled. */
export const RELAXED_RATE_LIMITS: AuthRateLimits = {
  ...DEFAULT_AUTH_RATE_LIMITS,
  loginPerIp: { limit: 1_000_000, windowMs: 60_000 },
  loginPerAccountIp: { free: 1_000_000, baseMs: 1, maxMs: 1, windowMs: 60_000 },
  loginPerAccount: { free: 1_000_000, baseMs: 1, maxMs: 1, windowMs: 60_000 },
  registerPerIp: { limit: 1_000_000, windowMs: 60_000 },
  refreshPerIp: { limit: 1_000_000, windowMs: 60_000 },
};

/**
 * Boots the real app with the production pipeline (setupApp). Security settings
 * come from `env` merged over a safe local baseline, so tests are deterministic.
 */
export async function createTestApp(
  env: Record<string, string | undefined> = {},
  extra: {
    controllers?: Type[];
    rateLimits?: AuthRateLimits;
    providers?: { provide: unknown; useValue: unknown }[];
  } = {},
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: extra.controllers ?? [],
  })
    .overrideProvider(AUTH_RATE_LIMITS)
    .useValue(extra.rateLimits ?? RELAXED_RATE_LIMITS);
  for (const p of extra.providers ?? []) {
    builder = builder.overrideProvider(p.provide).useValue(p.useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });
  setupApp(
    app,
    loadSecurityConfig({
      NODE_ENV: 'test',
      CORS_ORIGINS: 'http://localhost:3000',
      ...env,
    }),
  );
  await app.init();
  return app;
}
