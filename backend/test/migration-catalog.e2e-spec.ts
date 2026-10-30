/**
 * CAT-01 catalog migration, rehearsed on throwaway databases. Never touches the
 * development database: `tm_migration_test_cat_*` databases are created (as the
 * Postgres superuser), migrated as tm_migrator, and dropped.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: '../.env', quiet: true });

const MIGRATIONS = join(process.cwd(), '..', 'database', 'prisma', 'migrations');
const CATALOG = '20261029120000_catalog_schema';
const FRESH_DB = `tm_migration_test_cat_fresh_${process.pid}`;
const DATA_DB = `tm_migration_test_cat_data_${process.pid}`;
const TABLES = ['brands', 'categories', 'product_variants', 'products'];

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

const read = (path: string) => readFileSync(path, 'utf8');
const migrationSql = (name: string) => read(join(MIGRATIONS, name, 'migration.sql'));
const downSql = (name: string) => read(join(MIGRATIONS, name, 'down.sql'));
const allMigrations = () => readdirSync(MIGRATIONS).filter((n) => /^\d{14}_/.test(n)).sort();

let admin: pg.Client;
const clients: pg.Client[] = [];

async function createDb(name: string): Promise<pg.Client> {
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.query(`CREATE DATABASE "${name}" OWNER tm_migrator`);
  const client = new pg.Client({ connectionString: urlFor(name).toString() });
  await client.connect();
  clients.push(client);
  const { rows } = await client.query<{ db: string }>('select current_database() as db');
  if (rows[0].db !== name) throw new Error(`connected to ${rows[0].db}, expected ${name}`);
  // Same shape as Prisma's own bookkeeping table (earlier migrations reference it).
  await client.query(`create table _prisma_migrations (
    id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz,
    migration_name varchar(255) not null, logs text, rolled_back_at timestamptz,
    started_at timestamptz not null default now(), applied_steps_count integer not null default 0)`);
  return client;
}

async function apply(client: pg.Client, names: string[]): Promise<void> {
  for (const name of names) await client.query(migrationSql(name));
}

async function tablesOf(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ t: string }>(
    `select tablename as t from pg_tables where schemaname = 'public' and tablename = any($1) order by 1`,
    [TABLES],
  );
  return rows.map((r) => r.t);
}

let fresh: pg.Client;
let data: pg.Client;
const tenantId = randomUUID();
const companyId = randomUUID();

beforeAll(async () => {
  const target = urlFor(FRESH_DB);
  // Superuser on the maintenance database: only CREATE/DROP of the throwaway databases.
  admin = new pg.Client({
    host: target.hostname,
    port: Number(target.port || 5432),
    user: env('POSTGRES_USER'),
    password: env('POSTGRES_PASSWORD'),
    database: 'postgres',
  });
  await admin.connect();

  const all = allMigrations();
  if (!all.includes(CATALOG)) throw new Error(`${CATALOG} missing`);

  fresh = await createDb(FRESH_DB);
  await apply(fresh, all);

  // Existing data: every earlier migration, a tenant with system roles and a company, then CAT-01.
  data = await createDb(DATA_DB);
  await apply(data, all.slice(0, all.indexOf(CATALOG)));
  await data.query(`insert into tenants (id, name, slug, updated_at) values ($1, 'A', 'a', now())`, [tenantId]);
  await data.query(
    `insert into roles (id, tenant_id, name, permissions, key, scope, is_system, updated_at)
     select gen_random_uuid(), $1, c.name, c.perms, c.key, c.scope::role_scope, true, now()
     from (values ('owner','owner','tenant','{*}'::text[]), ('admin','Admin','tenant','{companies:read}'),
                  ('operations','Operasyon','company','{companies:read}'),
                  ('accounting','Muhasebe','company','{companies:read}'),
                  ('viewer','Görüntüleyici','company','{companies:read}')) c(key, name, scope, perms)`,
    [tenantId],
  );
  await data.query(
    `insert into companies (id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, updated_at)
     values ($1, $2, 'A Ltd', '1234567890', 'Kadıköy', 'Adres', 'Kadıköy', 'İstanbul', now())`,
    [companyId, tenantId],
  );
  await apply(data, [CATALOG]);
}, 60_000);

afterAll(async () => {
  for (const c of clients) await c.end();
  if (admin) {
    for (const db of [FRESH_DB, DATA_DB]) await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await admin.end();
  }
});

describe('catalog migration (CAT-01)', () => {
  it('creates the catalog tables on a fresh database', async () => {
    expect(await tablesOf(fresh)).toEqual(TABLES);
  });

  it('applies on a database with existing data and keeps it', async () => {
    expect(await tablesOf(data)).toEqual(TABLES);
    const { rows } = await data.query<{ n: number }>(
      'select (select count(*) from tenants)::int + (select count(*) from companies)::int as n',
    );
    expect(rows[0].n).toBe(2);
    await data.query(
      `insert into products (id, tenant_id, company_id, name, updated_at) values (gen_random_uuid(), $1, $2, 'Ürün', now())`,
      [tenantId, companyId],
    );
  });

  it('adds product permissions to the system roles', async () => {
    const { rows } = await data.query<{ key: string; perms: string[] }>(
      `select key, array(select p from unnest(permissions) p where p like 'products:%' order by p) as perms
       from roles where tenant_id = $1 order by key`,
      [tenantId],
    );
    expect(rows).toEqual([
      { key: 'accounting', perms: ['products:read'] },
      { key: 'admin', perms: ['products:read', 'products:write'] },
      { key: 'operations', perms: ['products:read', 'products:write'] },
      { key: 'owner', perms: [] },
      { key: 'viewer', perms: ['products:read'] },
    ]);
  });

  it('re-running the roles UPDATE is idempotent', async () => {
    const sql = migrationSql(CATALOG);
    const section = sql.slice(
      sql.indexOf('-- System role permissions'),
      sql.indexOf('-- Application role privileges'),
    );
    const snapshot = () =>
      data.query('select key, permissions from roles where tenant_id = $1 order by key', [tenantId]);
    const before = (await snapshot()).rows;
    await data.query(section);
    await data.query(section);
    expect((await snapshot()).rows).toEqual(before);
  });

  it('grants tm_app SELECT/INSERT/UPDATE but not DELETE/TRUNCATE', async () => {
    const { rows } = await fresh.query(
      `select t, has_table_privilege('tm_app', t, 'SELECT') s, has_table_privilege('tm_app', t, 'INSERT') i,
              has_table_privilege('tm_app', t, 'UPDATE') u, has_table_privilege('tm_app', t, 'DELETE') d,
              has_table_privilege('tm_app', t, 'TRUNCATE') tr
       from unnest($1::text[]) t order by t`,
      [TABLES],
    );
    expect(rows).toEqual(TABLES.map((t) => ({ t, s: true, i: true, u: true, d: false, tr: false })));
  });

  it('SQL-only constraints exist after migration', async () => {
    const { rows } = await fresh.query<{ c: string }>(
      `select conname as c from pg_constraint where conname = any($1) order by 1`,
      [['brands_name_trimmed', 'categories_no_self_parent', 'categories_slug_format', 'product_variants_barcode_not_blank', 'product_variants_barcode_trimmed', 'product_variants_sku_not_blank', 'product_variants_sku_trimmed']],
    );
    expect(rows.map((r) => r.c)).toEqual([
      'brands_name_trimmed',
      'categories_no_self_parent',
      'categories_slug_format',
      'product_variants_barcode_not_blank',
      'product_variants_barcode_trimmed',
      'product_variants_sku_not_blank',
      'product_variants_sku_trimmed',
    ]);
    const idx = await fresh.query<{ i: string; def: string }>(
      `select indexname as i, indexdef as def from pg_indexes
       where indexname in ('brands_tenant_id_name_active_key', 'categories_tenant_id_slug_active_key', 'brands_tenant_id_name_key', 'categories_tenant_id_slug_key')
       order by 1`,
    );
    expect(idx.rows.map((r) => r.i)).toEqual(['brands_tenant_id_name_active_key', 'categories_tenant_id_slug_active_key']);
    for (const r of idx.rows) expect(r.def).toMatch(/WHERE \(deleted_at IS NULL\)/);
  });

  it('down.sql leaves custom roles (key IS NULL) untouched', async () => {
    await fresh.query('BEGIN');
    try {
      const t = randomUUID();
      await fresh.query(`insert into tenants (id, name, slug, updated_at) values ($1, 'C', $2, now())`, [t, `c-${t}`]);
      await fresh.query(
        `insert into roles (id, tenant_id, name, permissions, scope, updated_at)
         values (gen_random_uuid(), $1, 'Özel', '{products:read}', 'tenant', now())`,
        [t],
      );
      // down.sql has its own BEGIN/COMMIT; run its body only, inside this transaction.
      await fresh.query(downSql(CATALOG).replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, ''));
      const { rows } = await fresh.query(`select permissions from roles where tenant_id = $1`, [t]);
      expect(rows[0].permissions).toEqual(['products:read']);
    } finally {
      await fresh.query('ROLLBACK');
    }
  });

  it('fails safely when applied a second time', async () => {
    await expect(fresh.query(migrationSql(CATALOG))).rejects.toThrow(/already exists/);
    expect(await tablesOf(fresh)).toEqual(TABLES);
  });

  it('down.sql removes the catalog and the permissions, and the migration re-applies', async () => {
    await data.query('BEGIN');
    try {
      // Products exist: down.sql must refuse to drop catalog data.
      await expect(data.query(downSql(CATALOG))).rejects.toThrow(/katalog verisi var/);
    } finally {
      await data.query('ROLLBACK');
    }

    await fresh.query(downSql(CATALOG));
    expect(await tablesOf(fresh)).toEqual([]);
    const { rows } = await fresh.query<{ n: number }>(
      `select count(*)::int as n from roles where exists (select 1 from unnest(permissions) p where p like 'products:%')`,
    );
    expect(rows[0].n).toBe(0);
    await fresh.query(migrationSql(CATALOG));
    expect(await tablesOf(fresh)).toEqual(TABLES);
  });
});
