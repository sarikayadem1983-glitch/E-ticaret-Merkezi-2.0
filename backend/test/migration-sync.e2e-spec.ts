/**
 * INT-02 sync engine migration, rehearsed on a throwaway database. Never touches the
 * development database: a `tm_migration_test_sync_*` database is created (as
 * the Postgres superuser), migrated as tm_migrator, and dropped.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: '../.env', quiet: true });

const MIGRATIONS = join(
  process.cwd(),
  '..',
  'database',
  'prisma',
  'migrations',
);
const NAME = '20261113120000_sync_engine';
const DB = `tm_migration_test_sync_${process.pid}`;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Refuses anything that is not a local, throwaway tm_migration_test database. */
function urlFor(db: string): URL {
  const url = new URL(env('MIGRATION_DATABASE_URL'));
  const devDb = url.pathname.replace(/^\//, '');
  if (!db.startsWith('tm_migration_test'))
    throw new Error(`unsafe database name: ${db}`);
  if (db === devDb || db === process.env.POSTGRES_DB)
    throw new Error('refusing the development database');
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error(`unsafe host: ${url.hostname}`);
  url.pathname = `/${db}`;
  return url;
}

const read = (name: string, file: string) =>
  readFileSync(join(MIGRATIONS, name, file), 'utf8');
const allMigrations = () =>
  readdirSync(MIGRATIONS)
    .filter((n) => /^\d{14}_/.test(n))
    .sort();

let admin: pg.Client;
let db: pg.Client;

const hasTables = async () =>
  (
    await db.query(
      `select to_regclass('public.sync_jobs') is not null and to_regclass('public.channel_external_refs') is not null as t`,
    )
  ).rows[0].t as boolean;

beforeAll(async () => {
  const target = urlFor(DB);
  admin = new pg.Client({
    host: target.hostname,
    port: Number(target.port || 5432),
    user: env('POSTGRES_USER'),
    password: env('POSTGRES_PASSWORD'),
    database: 'postgres',
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await admin.query(`CREATE DATABASE "${DB}" OWNER tm_migrator`);
  db = new pg.Client({ connectionString: target.toString() });
  await db.connect();
  const { rows } = await db.query<{ d: string }>(
    'select current_database() as d',
  );
  if (rows[0].d !== DB) throw new Error(`connected to ${rows[0].d}`);
  await db.query(`create table _prisma_migrations (
    id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz,
    migration_name varchar(255) not null, logs text, rolled_back_at timestamptz,
    started_at timestamptz not null default now(), applied_steps_count integer not null default 0)`);
  const all = allMigrations();
  if (!all.includes(NAME)) throw new Error(`${NAME} missing`);
  for (const name of all.slice(0, all.indexOf(NAME) + 1))
    await db.query(read(name, 'migration.sql'));
}, 180_000);

afterAll(async () => {
  await db?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});
describe('sync engine migration (INT-02)', () => {
  it('adds both tables; tm_app may select, insert and update but never delete', async () => {
    expect(await hasTables()).toBe(true);
    for (const table of ['sync_jobs', 'channel_external_refs']) {
      const { rows } = await db.query(
        `select has_table_privilege('tm_app', $1, 'SELECT') s, has_table_privilege('tm_app', $1, 'INSERT') i,
                has_table_privilege('tm_app', $1, 'UPDATE') u, has_table_privilege('tm_app', $1, 'DELETE') d,
                has_table_privilege('tm_app', $1, 'TRUNCATE') tr`,
        [table],
      );
      expect(rows[0]).toEqual({
        s: true,
        i: true,
        u: true,
        d: false,
        tr: false,
      });
    }
  });

  it('enforces uniqueness, account/company match, known states and code-only errors', async () => {
    await db.query('BEGIN');
    try {
      const t = randomUUID();
      const c = randomUUID();
      const c2 = randomUUID();
      const a = randomUUID();
      await db.query(
        `insert into tenants (id, name, slug, updated_at) values ($1, 'T', $2, now())`,
        [t, `t-${t}`],
      );
      for (const [id, tax] of [
        [c, '1234567890'],
        [c2, '1234567891'],
      ]) {
        await db.query(
          `insert into companies (id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, updated_at)
           values ($1, $2, 'A', $3, 'X', 'Y', 'Z', 'W', now())`,
          [id, t, tax],
        );
      }
      await db.query(
        `insert into channel_accounts (id, tenant_id, company_id, channel, name, credentials_ciphertext, credentials_iv,
           credentials_tag, wrapped_dek, dek_iv, dek_tag, kek_id, credentials_hint, updated_at)
         values ($1, $2, $3, 'trendyol', 'TY', decode('00', 'hex'), decode(repeat('00', 12), 'hex'),
           decode(repeat('00', 16), 'hex'), decode(repeat('00', 32), 'hex'), decode(repeat('00', 12), 'hex'),
           decode(repeat('00', 16), 'hex'), 'k1', '{}', now())`,
        [a, t, c],
      );
      const job = (
        key: string,
        opts: {
          company?: string;
          status?: string;
          errorCode?: string | null;
          kind?: string;
        } = {},
      ) =>
        db.query(
          `insert into sync_jobs (id, tenant_id, company_id, channel_account_id, kind, status, idempotency_key, error_code, updated_at)
           values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now())`,
          [
            t,
            opts.company ?? c,
            a,
            opts.kind ?? 'test.echo',
            opts.status ?? 'queued',
            key,
            opts.errorCode ?? null,
          ],
        );
      const ref = (
        externalId: string,
        entityType = 'order',
        hash = 'a'.repeat(64),
      ) =>
        db.query(
          `insert into channel_external_refs (id, tenant_id, channel_account_id, entity_type, external_id, payload_hash, updated_at)
           values (gen_random_uuid(), $1, $2, $3, $4, $5, now())`,
          [t, a, entityType, externalId, hash],
        );
      await job('k1');
      await ref('ORD-1');
      await db.query('SAVEPOINT s');
      const bad: [() => Promise<unknown>, RegExp][] = [
        [() => job('k1'), /idempotency_key_key/],
        [() => ref('ORD-1'), /entity_t_key/],
        [() => job('k2', { company: c2 }), /sync_jobs_account_company_fkey/],
        [() => job('k3', { status: 'done' }), /sync_jobs_status_known/],
        [
          () => job('k4', { errorCode: 'Token abc123 hatalı' }),
          /sync_jobs_error_code_format/,
        ],
        [() => job('k5', { kind: 'Bad Kind' }), /sync_jobs_kind_format/],
        [() => job(' '), /idempotency_key_not_blank/],
        [() => ref('ORD-2', 'invoice'), /entity_type_known/],
        [() => ref('ORD-3', 'order', 'XYZ'), /payload_hash_hex/],
      ];
      for (const [run, err] of bad) {
        await expect(run()).rejects.toThrow(err);
        await db.query('ROLLBACK TO SAVEPOINT s');
      }
      await expect(
        db.query(
          read(NAME, 'down.sql')
            .replace(/^BEGIN;$/m, '')
            .replace(/^COMMIT;$/m, ''),
        ),
      ).rejects.toThrow(/senkron verisi var/);
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('fails safely when applied twice; down.sql removes it and it re-applies', async () => {
    await expect(db.query(read(NAME, 'migration.sql'))).rejects.toThrow(
      /already exists/,
    );
    await db.query(read(NAME, 'down.sql'));
    expect(await hasTables()).toBe(false);
    await db.query(read(NAME, 'migration.sql'));
    expect(await hasTables()).toBe(true);
  });
});
