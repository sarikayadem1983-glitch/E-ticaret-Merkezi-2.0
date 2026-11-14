/**
 * ORD-01 order schema migration, rehearsed on a throwaway database. Never touches the
 * development database: a `tm_migration_test_orders_*` database is created (as
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
const NAME = '20261114120000_orders_schema';
const DB = `tm_migration_test_orders_${process.pid}`;

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
      `select to_regclass('public.orders') is not null and to_regclass('public.order_items') is not null and to_regclass('public.order_status_history') is not null as t`,
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
describe('order schema migration (ORD-01)', () => {
  it('adds the tables; tm_app never deletes, history is insert-only', async () => {
    expect(await hasTables()).toBe(true);
    const expected: Record<string, boolean> = {
      orders: true,
      order_items: true,
      order_status_history: false,
    };
    for (const [table, update] of Object.entries(expected)) {
      const { rows } = await db.query(
        `select has_table_privilege('tm_app', $1, 'SELECT') s, has_table_privilege('tm_app', $1, 'INSERT') i,
                has_table_privilege('tm_app', $1, 'UPDATE') u, has_table_privilege('tm_app', $1, 'DELETE') d,
                has_table_privilege('tm_app', $1, 'TRUNCATE') tr`,
        [table],
      );
      expect(rows[0]).toEqual({
        s: true,
        i: true,
        u: update,
        d: false,
        tr: false,
      });
    }
  });

  it('enforces uniqueness, tenant/company/channel links, money rules and known states', async () => {
    await db.query('BEGIN');
    try {
      const t = randomUUID();
      const t2 = randomUUID();
      const c = randomUUID();
      const c2 = randomUUID();
      const a = randomUUID();
      const p = randomUUID();
      const v = randomUUID();
      for (const id of [t, t2])
        await db.query(
          `insert into tenants (id, name, slug, updated_at) values ($1, 'T', $2, now())`,
          [id, `t-${id}`],
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
      await db.query(
        `insert into products (id, tenant_id, company_id, name, updated_at) values ($1, $2, $3, 'Ürün', now())`,
        [p, t, c],
      );
      await db.query(
        `insert into product_variants (id, tenant_id, company_id, product_id, sku, updated_at)
         values ($1, $2, $3, $4, 'SKU-1', now())`,
        [v, t, c, p],
      );

      type OrderOpts = {
        tenant?: string;
        company?: string;
        account?: string | null;
        channel?: string;
        status?: string;
        currency?: string;
        subtotal?: string;
        discount?: string;
        shipping?: string;
        total?: string;
      };
      const order = async (no: string | null, opts: OrderOpts = {}) =>
        (
          await db.query<{ id: string }>(
            `insert into orders (id, tenant_id, company_id, channel, channel_account_id, external_order_no, status,
               currency, subtotal, discount_total, shipping_total, total, ordered_at, updated_at)
             values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now()) returning id`,
            [
              opts.tenant ?? t,
              opts.company ?? c,
              opts.channel ?? 'trendyol',
              opts.account === undefined ? a : opts.account,
              no,
              opts.status ?? 'created',
              opts.currency ?? 'TRY',
              opts.subtotal ?? '199.90',
              opts.discount ?? '10.00',
              opts.shipping ?? '0.00',
              opts.total ?? '189.90',
            ],
          )
        ).rows[0].id;
      const o = await order('TY-1');
      // Manual order: no account, no marketplace number. Two manual orders never collide.
      await order(null, { channel: 'manual', account: null });
      await order(null, { channel: 'manual', account: null });

      type ItemOpts = {
        tenant?: string;
        variant?: string | null;
        line?: string | null;
        qty?: number;
        unit?: string;
        discount?: string;
        total?: string;
        vat?: string | null;
        sku?: string;
      };
      const item = (opts: ItemOpts = {}) =>
        db.query(
          `insert into order_items (id, tenant_id, order_id, variant_id, external_line_id, sku, name, quantity,
             unit_price, discount, vat_rate, line_total, updated_at)
           values (gen_random_uuid(), $1, $2, $3, $4, $5, 'Ürün', $6, $7, $8, $9, $10, now())`,
          [
            opts.tenant ?? t,
            o,
            opts.variant === undefined ? v : opts.variant,
            opts.line === undefined ? 'L1' : opts.line,
            opts.sku ?? 'SKU-1',
            opts.qty ?? 2,
            opts.unit ?? '99.95',
            opts.discount ?? '10.00',
            opts.vat === undefined ? '20' : opts.vat,
            opts.total ?? '189.90',
          ],
        );
      await item();
      // Unmatched marketplace lines (no variant) and lines without an external id are allowed.
      await item({ line: null, variant: null });
      await item({ line: null, variant: null });

      type HistoryOpts = {
        from?: string | null;
        to?: string;
        source?: string;
        by?: string | null;
        job?: string | null;
      };
      const history = (opts: HistoryOpts = {}) =>
        db.query(
          `insert into order_status_history (id, tenant_id, order_id, from_status, to_status, source, changed_by, sync_job_id)
           values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
          [
            t,
            o,
            opts.from ?? null,
            opts.to ?? 'created',
            opts.source ?? 'channel',
            opts.by ?? null,
            opts.job ?? null,
          ],
        );
      await history();
      await history({
        from: 'created',
        to: 'picking',
        source: 'user',
        by: randomUUID(),
      });

      await db.query('SAVEPOINT s');
      const bad: [() => Promise<unknown>, RegExp][] = [
        [() => order('TY-1'), /orders_tenant_id_channel_external_order_no_key/],
        [
          () => order('TY-2', { company: c2 }),
          /orders_account_company_channel_fkey/,
        ],
        [
          () => order('HB-1', { channel: 'hepsiburada' }),
          /orders_account_company_channel_fkey/,
        ],
        [() => order('TY-3', { tenant: t2 }), /fkey/],
        [() => order(null), /orders_account_has_external_no/],
        [
          () => order(' ', { account: null }),
          /orders_external_order_no_not_blank/,
        ],
        [() => order('TY-4', { status: 'done' }), /orders_status_known/],
        [() => order('TY-5', { currency: 'tl' }), /orders_currency_format/],
        [
          () => order('TY-6', { channel: 'Trendyol', account: null }),
          /orders_channel_format/,
        ],
        [() => order('TY-7', { total: '190.00' }), /orders_total_consistent/],
        [
          () =>
            order('TY-8', { subtotal: '0', discount: '5.00', total: '-5.00' }),
          /orders_amounts_non_negative/,
        ],
        [() => item(), /order_items_tenant_id_order_id_external_line_id_key/],
        [() => item({ line: 'L2', qty: 0, total: '-10.00' }), /order_items_/],
        [
          () => item({ line: 'L3', total: '199.90' }),
          /order_items_line_total_consistent/,
        ],
        [() => item({ line: 'L4', vat: '120' }), /order_items_vat_rate_range/],
        [() => item({ line: 'L5', sku: ' ' }), /order_items_sku_not_blank/],
        [() => item({ line: 'L6', tenant: t2 }), /fkey/],
        [
          () => item({ line: 'L7', variant: randomUUID() }),
          /order_items_tenant_id_variant_id_fkey/,
        ],
        [() => history({ to: 'done' }), /order_status_history_to_status_known/],
        [
          () => history({ from: 'x' }),
          /order_status_history_from_status_known/,
        ],
        [
          () => history({ source: 'robot' }),
          /order_status_history_source_known/,
        ],
        [
          () => history({ source: 'user' }),
          /order_status_history_user_source_has_actor/,
        ],
        [
          () => history({ job: randomUUID() }),
          /order_status_history_tenant_id_sync_job_id_fkey/,
        ],
      ];
      for (const [run, err] of bad) {
        await expect(run()).rejects.toThrow(err);
        await db.query('ROLLBACK TO SAVEPOINT s');
      }

      // Money is stored as NUMERIC: sums are exact, no float drift.
      const { rows } = await db.query<{ s: string }>(
        `select sum(line_total)::text s from order_items where order_id = $1 and external_line_id is not null`,
        [o],
      );
      expect(rows[0].s).toBe('189.90');

      await expect(
        db.query(
          read(NAME, 'down.sql')
            .replace(/^BEGIN;$/m, '')
            .replace(/^COMMIT;$/m, ''),
        ),
      ).rejects.toThrow(/sipariş verisi var/);
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
