/**
 * CAT-05 price migration, rehearsed on a throwaway database. Never touches the
 * development database: a `tm_migration_test_price_*` database is created (as
 * the Postgres superuser), migrated as tm_migrator, and dropped.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: '../.env', quiet: true });

const MIGRATIONS = join(process.cwd(), '..', 'database', 'prisma', 'migrations');
const NAME = '20261111120000_catalog_prices';
const DB = `tm_migration_test_price_${process.pid}`;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Refuses anything that is not a local, throwaway tm_migration_test database. */
function urlFor(db: string): URL {
  const url = new URL(env('MIGRATION_DATABASE_URL'));
  const devDb = url.pathname.replace(/^\//, '');
  if (!db.startsWith('tm_migration_test')) throw new Error(`unsafe database name: ${db}`);
  if (db === devDb || db === process.env.POSTGRES_DB) throw new Error('refusing the development database');
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error(`unsafe host: ${url.hostname}`);
  url.pathname = `/${db}`;
  return url;
}

const read = (name: string, file: string) => readFileSync(join(MIGRATIONS, name, file), 'utf8');
const allMigrations = () => readdirSync(MIGRATIONS).filter((n) => /^\d{14}_/.test(n)).sort();

let admin: pg.Client;
let db: pg.Client;

const hasTable = async () =>
  (await db.query(`select to_regclass('public.variant_prices') is not null as t`)).rows[0].t as boolean;
const hasVatColumn = async () =>
  (
    await db.query(
      `select exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'vat_rate') as c`,
    )
  ).rows[0].c as boolean;

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
  const { rows } = await db.query<{ d: string }>('select current_database() as d');
  if (rows[0].d !== DB) throw new Error(`connected to ${rows[0].d}`);
  await db.query(`create table _prisma_migrations (
    id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz,
    migration_name varchar(255) not null, logs text, rolled_back_at timestamptz,
    started_at timestamptz not null default now(), applied_steps_count integer not null default 0)`);
  const all = allMigrations();
  if (!all.includes(NAME)) throw new Error(`${NAME} missing`);
  for (const name of all.slice(0, all.indexOf(NAME) + 1)) await db.query(read(name, 'migration.sql'));
}, 180_000);

afterAll(async () => {
  await db?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});

describe('price migration (CAT-05)', () => {
  it('adds variant_prices and products.vat_rate with grants', async () => {
    expect(await hasTable()).toBe(true);
    expect(await hasVatColumn()).toBe(true);
    const { rows } = await db.query(
      `select has_table_privilege('tm_app', 'variant_prices', 'SELECT') s, has_table_privilege('tm_app', 'variant_prices', 'INSERT') i,
              has_table_privilege('tm_app', 'variant_prices', 'UPDATE') u, has_table_privilege('tm_app', 'variant_prices', 'DELETE') d,
              has_table_privilege('tm_app', 'variant_prices', 'TRUNCATE') tr`,
    );
    expect(rows[0]).toEqual({ s: true, i: true, u: true, d: false, tr: false });
  });

  it('enforces money shape, one active price per channel and VAT range', async () => {
    await db.query('BEGIN');
    try {
      const t = randomUUID();
      const c = randomUUID();
      const p = randomUUID();
      const v = randomUUID();
      await db.query(`insert into tenants (id, name, slug, updated_at) values ($1, 'T', $2, now())`, [t, `t-${t}`]);
      await db.query(
        `insert into companies (id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, updated_at)
         values ($1, $2, 'A', '1234567890', 'X', 'Y', 'Z', 'W', now())`,
        [c, t],
      );
      await db.query(`insert into products (id, tenant_id, company_id, name, updated_at) values ($1, $2, $3, 'P', now())`, [p, t, c]);
      await db.query(
        `insert into product_variants (id, tenant_id, company_id, product_id, sku, updated_at) values ($1, $2, $3, $4, 'S', now())`,
        [v, t, c, p],
      );
      const price = (channel: string, amount: string, currency = 'TRY') =>
        db.query(
          `insert into variant_prices (id, tenant_id, variant_id, channel, amount, currency, updated_at)
           values (gen_random_uuid(), $1, $2, $3, $4, $5, now())`,
          [t, v, channel, amount, currency],
        );
      await price('list', '199.90');
      const stored = await db.query(`select amount::text a from variant_prices where variant_id = $1`, [v]);
      expect(stored.rows[0].a).toBe('199.90');
      await db.query('SAVEPOINT s');
      const bad: [string, string, string, RegExp][] = [
        ['list', '10', 'TRY', /active_key/],
        ['trendyol', '-1', 'TRY', /amount_non_negative/],
        ['trendyol', '1', 'try', /currency_format/],
        ['Trendyol', '1', 'TRY', /channel_format/],
      ];
      for (const [channel, amount, currency, err] of bad) {
        await expect(price(channel, amount, currency)).rejects.toThrow(err);
        await db.query('ROLLBACK TO SAVEPOINT s');
      }
      await expect(db.query(`update products set vat_rate = 101 where id = $1`, [p])).rejects.toThrow(/vat_rate_range/);
      await db.query('ROLLBACK TO SAVEPOINT s');
      await expect(
        db.query(read(NAME, 'down.sql').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')),
      ).rejects.toThrow(/fiyat verisi var/);
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('fails safely when applied twice; down.sql removes it and it re-applies', async () => {
    await expect(db.query(read(NAME, 'migration.sql'))).rejects.toThrow(/already exists/);
    await db.query(read(NAME, 'down.sql'));
    expect(await hasTable()).toBe(false);
    expect(await hasVatColumn()).toBe(false);
    await db.query(read(NAME, 'migration.sql'));
    expect(await hasTable()).toBe(true);
  });
});
