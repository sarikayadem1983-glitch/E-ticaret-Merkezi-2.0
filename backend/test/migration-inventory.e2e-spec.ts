/**
 * INV-01 inventory schema migration, rehearsed on a throwaway database. Never touches the
 * development database: a `tm_migration_test_inventory_*` database is created (as
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
const NAME = '20261114150000_inventory_schema';
const DB = `tm_migration_test_inventory_${process.pid}`;

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
      `select to_regclass('public.warehouses') is not null and to_regclass('public.stock_levels') is not null and to_regclass('public.stock_movements') is not null as t`,
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
/** Tenant, two companies, a warehouse per company and a variant per company. */
async function seed(client: pg.Client) {
  const ids = {
    t: randomUUID(),
    c: randomUUID(),
    c2: randomUUID(),
    w: randomUUID(),
    w2: randomUUID(),
    p: randomUUID(),
    p2: randomUUID(),
    v: randomUUID(),
    v2: randomUUID(),
  };
  const tax = String(Date.now() % 1e9).padStart(9, '0');
  await client.query(
    `insert into tenants (id, name, slug, updated_at) values ($1, 'T', $2, now())`,
    [ids.t, `t-${ids.t}`],
  );
  for (const [id, n] of [
    [ids.c, '0'],
    [ids.c2, '1'],
  ])
    await client.query(
      `insert into companies (id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, updated_at)
       values ($1, $2, 'A', $3, 'X', 'Y', 'Z', 'W', now())`,
      [id, ids.t, tax + n],
    );
  for (const [w, c] of [
    [ids.w, ids.c],
    [ids.w2, ids.c2],
  ])
    await client.query(
      `insert into warehouses (id, tenant_id, company_id, name, is_default, updated_at) values ($1, $2, $3, 'Ana Depo', true, now())`,
      [w, ids.t, c],
    );
  for (const [p, v, c, sku] of [
    [ids.p, ids.v, ids.c, 'SKU-1'],
    [ids.p2, ids.v2, ids.c2, 'SKU-2'],
  ]) {
    await client.query(
      `insert into products (id, tenant_id, company_id, name, updated_at) values ($1, $2, $3, 'Ürün', now())`,
      [p, ids.t, c],
    );
    await client.query(
      `insert into product_variants (id, tenant_id, company_id, product_id, sku, updated_at) values ($1, $2, $3, $4, $5, now())`,
      [v, ids.t, c, p, `${sku}-${ids.t}`],
    );
  }
  return ids;
}

type MoveOpts = {
  company?: string;
  warehouse?: string;
  variant?: string;
  reason?: string;
  refType?: string | null;
  refId?: string | null;
};

const move = (
  client: pg.Client,
  ids: Awaited<ReturnType<typeof seed>>,
  quantity: number,
  opts: MoveOpts = {},
) =>
  client.query(
    `insert into stock_movements (id, tenant_id, company_id, warehouse_id, variant_id, quantity, reason, reference_type, reference_id)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ids.t,
      opts.company ?? ids.c,
      opts.warehouse ?? ids.w,
      opts.variant ?? ids.v,
      quantity,
      opts.reason ?? (quantity > 0 ? 'purchase' : 'adjustment'),
      opts.refType === undefined ? null : opts.refType,
      opts.refId === undefined ? null : opts.refId,
    ],
  );

const onHand = async (
  client: pg.Client,
  ids: { t: string; w: string; v: string },
) =>
  (
    await client.query<{ on_hand: number }>(
      `select on_hand from stock_levels where tenant_id = $1 and warehouse_id = $2 and variant_id = $3`,
      [ids.t, ids.w, ids.v],
    )
  ).rows[0]?.on_hand;

describe('inventory schema migration (INV-01)', () => {
  it('grants: movements append-only, levels read + reserved only, no deletes', async () => {
    expect(await hasTables()).toBe(true);
    const priv = async (table: string, p: string) =>
      (
        await db.query<{ ok: boolean }>(
          `select has_table_privilege('tm_app', $1, $2) ok`,
          [table, p],
        )
      ).rows[0].ok;
    const col = async (table: string, column: string, p: string) =>
      (
        await db.query<{ ok: boolean }>(
          `select has_column_privilege('tm_app', $1, $2, $3) ok`,
          [table, column, p],
        )
      ).rows[0].ok;
    expect(
      await Promise.all(
        ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'].map((p) =>
          priv('warehouses', p),
        ),
      ),
    ).toEqual([true, true, true, false, false]);
    expect(
      await Promise.all(
        ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'].map((p) =>
          priv('stock_movements', p),
        ),
      ),
    ).toEqual([true, true, false, false, false]);
    expect(
      await Promise.all(
        ['SELECT', 'INSERT', 'DELETE', 'TRUNCATE'].map((p) =>
          priv('stock_levels', p),
        ),
      ),
    ).toEqual([true, false, false, false]);
    expect(await col('stock_levels', 'reserved', 'UPDATE')).toBe(true);
    expect(await col('stock_levels', 'on_hand', 'UPDATE')).toBe(false);
    expect(await col('stock_levels', 'variant_id', 'UPDATE')).toBe(false);
  });

  it('stock = sum of movements; constraints, tenant/company links and references', async () => {
    await db.query('BEGIN');
    try {
      const ids = await seed(db);
      await move(db, ids, 10, { reason: 'opening' });
      await move(db, ids, -3, {
        reason: 'order',
        refType: 'order_item',
        refId: randomUUID(),
      });
      await move(db, ids, 2, {
        reason: 'return',
        refType: 'order_item',
        refId: randomUUID(),
      });
      await move(db, ids, -1);
      expect(await onHand(db, ids)).toBe(8);
      const sum = await db.query<{ s: number }>(
        `select sum(quantity)::int s from stock_movements where tenant_id = $1 and warehouse_id = $2 and variant_id = $3`,
        [ids.t, ids.w, ids.v],
      );
      expect(sum.rows[0].s).toBe(8);

      const ref = randomUUID();
      await move(db, ids, -1, {
        reason: 'order',
        refType: 'order_item',
        refId: ref,
      });
      await db.query('SAVEPOINT s');
      const bad: [() => Promise<unknown>, RegExp][] = [
        // Would drive stock below zero: the trigger's update hits the CHECK, the movement is rejected.
        [() => move(db, ids, -8), /stock_levels_on_hand_non_negative/],
        [
          () =>
            move(db, ids, -1, {
              reason: 'order',
              refType: 'order_item',
              refId: ref,
            }),
          /stock_movements_reference_key/,
        ],
        [() => move(db, ids, 0), /stock_movements_quantity_non_zero/],
        [
          () => move(db, ids, 1, { reason: 'gift' }),
          /stock_movements_reason_known/,
        ],
        [
          () => move(db, ids, 1, { refType: 'invoice', refId: randomUUID() }),
          /stock_movements_reference_type_known/,
        ],
        [
          () => move(db, ids, 1, { refType: 'order' }),
          /stock_movements_reference_complete/,
        ],
        [
          () => move(db, ids, 1, { refType: 'manual', refId: randomUUID() }),
          /stock_movements_reference_complete/,
        ],
        [
          () =>
            move(db, ids, 1, {
              reason: 'order',
              refType: 'order',
              refId: randomUUID(),
            }),
          /stock_movements_direction_matches_reason/,
        ],
        [
          () => move(db, ids, -1, { reason: 'purchase' }),
          /stock_movements_direction_matches_reason/,
        ],
        // Company c's movement on company c2's variant or warehouse.
        [
          () => move(db, ids, 1, { variant: ids.v2 }),
          /stock_movements_tenant_id_company_id_variant_id_fkey/,
        ],
        [
          () => move(db, ids, 1, { warehouse: ids.w2 }),
          /stock_movements_tenant_id_company_id_warehouse_id_fkey/,
        ],
        [
          () =>
            db.query(
              `insert into warehouses (id, tenant_id, company_id, name, updated_at) values (gen_random_uuid(), $1, $2, 'ANA DEPO', now())`,
              [ids.t, ids.c],
            ),
          /warehouses_tenant_id_company_id_lower_name_key/,
        ],
        [
          () =>
            db.query(
              `insert into warehouses (id, tenant_id, company_id, name, is_default, updated_at) values (gen_random_uuid(), $1, $2, 'Yedek', true, now())`,
              [ids.t, ids.c],
            ),
          /warehouses_tenant_id_company_id_default_key/,
        ],
        [
          () =>
            db.query(
              `insert into warehouses (id, tenant_id, company_id, name, updated_at) values (gen_random_uuid(), $1, $2, ' ', now())`,
              [ids.t, ids.c],
            ),
          /warehouses_name_not_blank/,
        ],
        [
          () =>
            db.query(
              `update stock_levels set reserved = -1 where tenant_id = $1`,
              [ids.t],
            ),
          /stock_levels_reserved_non_negative/,
        ],
      ];
      for (const [run, err] of bad) {
        await expect(run()).rejects.toThrow(err);
        await db.query('ROLLBACK TO SAVEPOINT s');
      }
      expect(await onHand(db, ids)).toBe(7);

      await expect(
        db.query(
          read(NAME, 'down.sql')
            .replace(/^BEGIN;$/m, '')
            .replace(/^COMMIT;$/m, ''),
        ),
      ).rejects.toThrow(/stok verisi var/);
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('concurrent decreases never oversell: one of two -5 on 8 fails', async () => {
    const other = new pg.Client({ connectionString: urlFor(DB).toString() });
    await other.connect();
    try {
      const ids = await seed(db);
      await move(db, ids, 8, { reason: 'opening' });
      await db.query('BEGIN');
      await other.query('BEGIN');
      await move(db, ids, -5, {
        reason: 'order',
        refType: 'order_item',
        refId: randomUUID(),
      });
      // Blocks on the stock_levels row lock until the first transaction commits.
      const second = move(other, ids, -5, {
        reason: 'order',
        refType: 'order_item',
        refId: randomUUID(),
      }).then(
        () => 'ok',
        (e: Error) => e.message,
      );
      await new Promise((r) => setTimeout(r, 200));
      await db.query('COMMIT');
      expect(await second).toMatch(/stock_levels_on_hand_non_negative/);
      await other.query('ROLLBACK');
      expect(await onHand(db, ids)).toBe(3);
    } finally {
      await other.end();
      // Test data only (owner role); the app role cannot delete.
      await db.query(`delete from stock_movements; delete from stock_levels; delete from warehouses;
        delete from product_variants; delete from products; delete from companies; delete from tenants;`);
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
