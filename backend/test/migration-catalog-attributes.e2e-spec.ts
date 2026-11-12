/**
 * CAT-03 variant attribute migration, rehearsed on a throwaway database. Never
 * touches the development database: a `tm_migration_test_attr_*` database is
 * created (as the Postgres superuser), migrated as tm_migrator, and dropped.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: '../.env', quiet: true });

const MIGRATIONS = join(process.cwd(), '..', 'database', 'prisma', 'migrations');
const NAME = '20261111090000_catalog_variant_attributes';
const DB = `tm_migration_test_attr_${process.pid}`;
const TABLES = ['attribute_values', 'attributes', 'variant_attribute_values'];

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

async function tables(): Promise<string[]> {
  const { rows } = await db.query<{ t: string }>(
    `select tablename as t from pg_tables where schemaname = 'public' and tablename = any($1) order by 1`,
    [TABLES],
  );
  return rows.map((r) => r.t);
}

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

describe('variant attribute migration (CAT-03)', () => {
  it('creates the tables', async () => {
    expect(await tables()).toEqual(TABLES);
  });

  it('grants tm_app SELECT/INSERT/UPDATE but not DELETE/TRUNCATE', async () => {
    const { rows } = await db.query(
      `select t, has_table_privilege('tm_app', t, 'SELECT') s, has_table_privilege('tm_app', t, 'INSERT') i,
              has_table_privilege('tm_app', t, 'UPDATE') u, has_table_privilege('tm_app', t, 'DELETE') d,
              has_table_privilege('tm_app', t, 'TRUNCATE') tr
       from unnest($1::text[]) t order by t`,
      [TABLES],
    );
    expect(rows).toEqual(TABLES.map((t) => ({ t, s: true, i: true, u: true, d: false, tr: false })));
  });

  it('SQL-only constraints and partial unique indexes exist', async () => {
    const { rows } = await db.query<{ c: string }>(
      `select conname as c from pg_constraint where conname like 'attribute%' and contype = 'c' order by 1`,
    );
    expect(rows.map((r) => r.c)).toEqual([
      'attribute_values_sort_order_range',
      'attribute_values_value_trimmed',
      'attributes_name_trimmed',
    ]);
    const idx = await db.query<{ i: string; def: string }>(
      `select indexname as i, indexdef as def from pg_indexes where indexname like '%active_key' and tablename like 'attribute%' order by 1`,
    );
    expect(idx.rows.map((r) => r.i)).toEqual([
      'attribute_values_tenant_id_attribute_id_value_active_key',
      'attributes_tenant_id_name_active_key',
    ]);
    for (const r of idx.rows) expect(r.def).toMatch(/lower\(btrim.*WHERE \(deleted_at IS NULL\)/);
  });

  it('links a value only under its own attribute and tenant', async () => {
    await db.query('BEGIN');
    try {
      const t = randomUUID();
      const c = randomUUID();
      const p = randomUUID();
      const v = randomUUID();
      const colour = randomUUID();
      const size = randomUUID();
      const red = randomUUID();
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
      await db.query(
        `insert into attributes (id, tenant_id, name, updated_at) values ($1, $3, 'Renk', now()), ($2, $3, 'Beden', now())`,
        [colour, size, t],
      );
      await db.query(
        `insert into attribute_values (id, tenant_id, attribute_id, value, updated_at) values ($1, $2, $3, 'Kırmızı', now())`,
        [red, t, colour],
      );
      await db.query('SAVEPOINT s');
      await expect(
        db.query(
          `insert into attribute_values (id, tenant_id, attribute_id, value, updated_at) values (gen_random_uuid(), $1, $2, ' KIRMIZI', now())`,
          [t, colour],
        ),
      ).rejects.toThrow(/attribute_values_value_trimmed/);
      await db.query('ROLLBACK TO SAVEPOINT s');
      await expect(
        db.query(
          `insert into attribute_values (id, tenant_id, attribute_id, value, updated_at) values (gen_random_uuid(), $1, $2, 'kırmızı', now())`,
          [t, colour],
        ),
      ).rejects.toThrow(/active_key/);
      await db.query('ROLLBACK TO SAVEPOINT s');
      // Red is a colour: it cannot be the variant's size.
      await expect(
        db.query(
          `insert into variant_attribute_values (tenant_id, variant_id, attribute_id, attribute_value_id, updated_at) values ($1, $2, $3, $4, now())`,
          [t, v, size, red],
        ),
      ).rejects.toThrow(/foreign key/);
      await db.query('ROLLBACK TO SAVEPOINT s');
      await db.query(
        `insert into variant_attribute_values (tenant_id, variant_id, attribute_id, attribute_value_id, updated_at) values ($1, $2, $3, $4, now())`,
        [t, v, colour, red],
      );
      // One value per axis.
      await expect(
        db.query(
          `insert into variant_attribute_values (tenant_id, variant_id, attribute_id, attribute_value_id, updated_at) values ($1, $2, $3, $4, now())`,
          [t, v, colour, red],
        ),
      ).rejects.toThrow(/variant_attribute_values_pkey/);
      await db.query('ROLLBACK TO SAVEPOINT s');
      // down.sql refuses while attribute rows exist (its own BEGIN/COMMIT stripped).
      await expect(
        db.query(read(NAME, 'down.sql').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')),
      ).rejects.toThrow(/özellik verisi var/);
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('fails safely when applied twice; down.sql removes it and it re-applies', async () => {
    await expect(db.query(read(NAME, 'migration.sql'))).rejects.toThrow(/already exists/);
    expect(await tables()).toEqual(TABLES);
    await db.query(read(NAME, 'down.sql'));
    expect(await tables()).toEqual([]);
    await db.query(read(NAME, 'migration.sql'));
    expect(await tables()).toEqual(TABLES);
  });
});
