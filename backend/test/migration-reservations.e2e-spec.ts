/**
 * INV-02 stock reservation migration, rehearsed on a throwaway database. Never touches the
 * development database: a `tm_migration_test_reservations_*` database is created (as
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
const NAME = '20261114170000_stock_reservations';
const DB = `tm_migration_test_reservations_${process.pid}`;

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
      `select to_regclass('public.stock_reservations') is not null as t`,
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
/** Same throwaway database, but as the application role tm_app (DATABASE_URL credentials). */
function appUrl(): string {
  const app = new URL(env('DATABASE_URL'));
  const target = urlFor(DB);
  target.username = app.username;
  target.password = app.password;
  return target.toString();
}

type Ids = Awaited<ReturnType<typeof seed>>;

/** Tenant with a company, warehouse, variant (on_hand = stock) and an order with two lines. */
async function seed(client: pg.Client, stock: number) {
  const ids = {
    t: randomUUID(),
    c: randomUUID(),
    w: randomUUID(),
    p: randomUUID(),
    v: randomUUID(),
    o: randomUUID(),
    i1: randomUUID(),
    i2: randomUUID(),
  };
  await client.query(
    `insert into tenants (id, name, slug, updated_at) values ($1, 'T', $2, now())`,
    [ids.t, `t-${ids.t}`],
  );
  await client.query(
    `insert into companies (id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, updated_at)
     values ($1, $2, 'A', $3, 'X', 'Y', 'Z', 'W', now())`,
    [ids.c, ids.t, String(Date.now() % 1e10).padStart(10, '0')],
  );
  await client.query(
    `insert into warehouses (id, tenant_id, company_id, name, updated_at) values ($1, $2, $3, 'Ana', now())`,
    [ids.w, ids.t, ids.c],
  );
  await client.query(
    `insert into products (id, tenant_id, company_id, name, updated_at) values ($1, $2, $3, 'Ürün', now())`,
    [ids.p, ids.t, ids.c],
  );
  await client.query(
    `insert into product_variants (id, tenant_id, company_id, product_id, sku, updated_at) values ($1, $2, $3, $4, $5, now())`,
    [ids.v, ids.t, ids.c, ids.p, `S-${ids.t}`],
  );
  if (stock > 0)
    await client.query(
      `insert into stock_movements (id, tenant_id, company_id, warehouse_id, variant_id, quantity, reason)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, 'opening')`,
      [ids.t, ids.c, ids.w, ids.v, stock],
    );
  await client.query(
    `insert into orders (id, tenant_id, company_id, channel, currency, subtotal, total, ordered_at, updated_at)
     values ($1, $2, $3, 'manual', 'TRY', 0, 0, now(), now())`,
    [ids.o, ids.t, ids.c],
  );
  for (const i of [ids.i1, ids.i2])
    await client.query(
      `insert into order_items (id, tenant_id, company_id, order_id, variant_id, sku, name, quantity, unit_price, line_total, updated_at)
       values ($1, $2, $3, $4, $5, 'S', 'Ürün', 1, 0, 0, now())`,
      [i, ids.t, ids.c, ids.o, ids.v],
    );
  return ids;
}

async function purge(ids: Ids) {
  await db.query('BEGIN');
  await db.query("SET LOCAL app.allow_stock_purge = 'on'");
  for (const table of [
    'stock_reservations',
    'stock_movements',
    'stock_levels',
    'warehouses',
    'order_items',
    'orders',
    'product_variants',
    'products',
    'companies',
  ])
    await db.query(`delete from ${table} where tenant_id = $1`, [ids.t]);
  await db.query('delete from tenants where id = $1', [ids.t]);
  await db.query('COMMIT');
}

const reserve = (
  c: pg.Client,
  ids: Ids,
  item: string,
  qty: number,
  tenant = ids.t,
  wh = ids.w,
) =>
  c.query<{ id: string }>('select stock_reserve($1, $2, $3, $4) as id', [
    tenant,
    item,
    wh,
    qty,
  ]);
const release = (c: pg.Client, ids: Ids, item: string) =>
  c.query<{ n: number }>('select stock_release($1, $2) as n', [ids.t, item]);
const consume = (c: pg.Client, ids: Ids, item: string) =>
  c.query<{ n: number }>('select stock_consume($1, $2, $3) as n', [
    ids.t,
    item,
    randomUUID(),
  ]);
const level = async (ids: Ids) =>
  (
    await db.query<{ on_hand: number; reserved: number }>(
      'select on_hand, reserved from stock_levels where tenant_id = $1 and warehouse_id = $2 and variant_id = $3',
      [ids.t, ids.w, ids.v],
    )
  ).rows[0];

describe('stock reservation migration (INV-02)', () => {
  it('grants: reservations read-only for tm_app, functions executable by tm_app only', async () => {
    expect(await hasTables()).toBe(true);
    const { rows } = await db.query(
      `select has_table_privilege('tm_app', 'stock_reservations', 'SELECT') s,
              has_table_privilege('tm_app', 'stock_reservations', 'INSERT') i,
              has_table_privilege('tm_app', 'stock_reservations', 'UPDATE') u,
              has_table_privilege('tm_app', 'stock_reservations', 'DELETE') d,
              has_function_privilege('tm_app', 'stock_reserve(uuid,uuid,uuid,integer)', 'EXECUTE') r,
              has_function_privilege('tm_app', 'stock_release(uuid,uuid)', 'EXECUTE') rl,
              has_function_privilege('tm_app', 'stock_consume(uuid,uuid,uuid)', 'EXECUTE') c,
              has_function_privilege('public', 'stock_reserve(uuid,uuid,uuid,integer)', 'EXECUTE') pub`,
    );
    expect(rows[0]).toEqual({
      s: true,
      i: false,
      u: false,
      d: false,
      r: true,
      rl: true,
      c: true,
      pub: false,
    });
  });

  it('reserve, release and consume keep on_hand, reserved and movements consistent', async () => {
    const ids = await seed(db, 5);
    try {
      const first = (await reserve(db, ids, ids.i1, 3)).rows[0].id;
      expect(await level(ids)).toEqual({ on_hand: 5, reserved: 3 });
      // Idempotent repeat with the same quantity returns the same reservation.
      expect((await reserve(db, ids, ids.i1, 3)).rows[0].id).toBe(first);
      await expect(reserve(db, ids, ids.i1, 2)).rejects.toThrow(
        /STOCK_ALREADY_RESERVED/,
      );
      // Only 2 available.
      await expect(reserve(db, ids, ids.i2, 3)).rejects.toThrow(
        /STOCK_INSUFFICIENT/,
      );
      // Reserved units cannot be adjusted away.
      await expect(
        db.query(
          `insert into stock_movements (id, tenant_id, company_id, warehouse_id, variant_id, quantity, reason, created_by)
           values (gen_random_uuid(), $1, $2, $3, $4, -4, 'adjustment', gen_random_uuid())`,
          [ids.t, ids.c, ids.w, ids.v],
        ),
      ).rejects.toThrow(/stock_levels_reserved_within_on_hand/);
      // Another tenant id never finds this tenant's order line.
      await expect(reserve(db, ids, ids.i2, 1, randomUUID())).rejects.toThrow(
        /STOCK_ORDER_ITEM_NOT_FOUND/,
      );
      await expect(
        reserve(db, ids, ids.i2, 1, ids.t, randomUUID()),
      ).rejects.toThrow(/STOCK_WAREHOUSE_NOT_FOUND/);
      await expect(reserve(db, ids, ids.i2, 0)).rejects.toThrow(
        /STOCK_INVALID_REQUEST/,
      );

      await reserve(db, ids, ids.i2, 2);
      expect(await level(ids)).toEqual({ on_hand: 5, reserved: 5 });
      expect((await release(db, ids, ids.i2)).rows[0].n).toBe(1);
      expect((await release(db, ids, ids.i2)).rows[0].n).toBe(0);
      expect(await level(ids)).toEqual({ on_hand: 5, reserved: 3 });

      expect((await consume(db, ids, ids.i1)).rows[0].n).toBe(1);
      expect(await level(ids)).toEqual({ on_hand: 2, reserved: 0 });
      expect((await consume(db, ids, ids.i1)).rows[0].n).toBe(0);
      const mv = await db.query<{ q: number; reason: string; ref: string }>(
        `select quantity q, reason, reference_id ref from stock_movements where tenant_id = $1 and reason = 'order'`,
        [ids.t],
      );
      expect(mv.rows).toEqual([{ q: -3, reason: 'order', ref: ids.i1 }]);
      const st = await db.query<{ status: string }>(
        'select status from stock_reservations where tenant_id = $1 order by created_at, status',
        [ids.t],
      );
      expect(st.rows.map((r) => r.status).sort()).toEqual([
        'consumed',
        'released',
      ]);
      // Data present: the undo refuses to run.
      await expect(
        db.query(
          read(NAME, 'down.sql')
            .replace(/^BEGIN;$/m, '')
            .replace(/^COMMIT;$/m, ''),
        ),
      ).rejects.toThrow(/rezervasyon verisi var/);
    } finally {
      await purge(ids);
    }
  });

  it('as tm_app: concurrent reservations of the last units never oversell', async () => {
    const ids = await seed(db, 3);
    const a = new pg.Client({ connectionString: appUrl() });
    const b = new pg.Client({ connectionString: appUrl() });
    await a.connect();
    await b.connect();
    try {
      expect(
        (await a.query<{ u: string }>('select current_user u')).rows[0].u,
      ).toBe('tm_app');
      await expect(
        a.query('update stock_levels set reserved = 0 where tenant_id = $1', [
          ids.t,
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        a.query(
          'insert into stock_reservations (id) values (gen_random_uuid())',
        ),
      ).rejects.toThrow(/permission denied/);

      await a.query('BEGIN');
      await b.query('BEGIN');
      await reserve(a, ids, ids.i1, 2);
      const bPid = (await b.query<{ p: number }>('select pg_backend_pid() p'))
        .rows[0].p;
      const second = reserve(b, ids, ids.i2, 2).then(
        () => 'ok',
        (e: Error) => e.message,
      );
      let waiting = false;
      for (let i = 0; i < 50 && !waiting; i++) {
        const r = await admin.query<{ w: string | null }>(
          'select wait_event_type w from pg_stat_activity where pid = $1',
          [bPid],
        );
        waiting = r.rows[0]?.w === 'Lock';
        if (!waiting) await new Promise((r2) => setTimeout(r2, 20));
      }
      expect(waiting).toBe(true);
      await a.query('COMMIT');
      expect(await second).toMatch(/STOCK_INSUFFICIENT/);
      await b.query('ROLLBACK');
      expect(await level(ids)).toEqual({ on_hand: 3, reserved: 2 });
    } finally {
      await a.end();
      await b.end();
      await purge(ids);
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
