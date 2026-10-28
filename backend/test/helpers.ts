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
 * Removes test tenants and everything they own. audit_logs is append-only, so
 * its rows are removed by the table owner under the purge flag the trigger allows.
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
      await client.query("SET LOCAL app.allow_audit_purge = 'on'");
      for (const table of ['audit_logs', 'companies', 'users', 'roles']) {
        await client.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1)`, [
          ids,
        ]);
      }
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
