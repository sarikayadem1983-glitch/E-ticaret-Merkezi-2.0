/** Cost migration rehearsal on a separate disposable local database, never the source DB. */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { config } from 'dotenv';

config({ path: '../.env', quiet: true });

const NAME = '20261126200000_variant_purchase_cost';
const ROOT = join(process.cwd(), '..', 'database', 'prisma', 'migrations');
const DB = `tm_migration_test_cost_${process.pid}_${randomUUID().slice(0, 8)}`;
const sql = (file: string) => readFileSync(join(ROOT, NAME, file), 'utf8');
const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} required`);
  return v;
};
let admin: pg.Client, db: pg.Client;
let created = false;
const tenant = randomUUID(),
  company = randomUUID(),
  product = randomUUID(),
  variant = randomUUID();
let before: unknown[];
const columns = async () =>
  (
    await db.query(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='product_variants' ORDER BY ordinal_position`,
    )
  ).rows;

beforeAll(async () => {
  const url = new URL(env('MIGRATION_DATABASE_URL'));
  if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !DB.startsWith('tm_migration_test_cost_') ||
    url.pathname === `/${DB}` ||
    process.env.POSTGRES_DB === DB
  )
    throw new Error('Unsafe migration rehearsal target');
  admin = new pg.Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: env('POSTGRES_USER'),
    password: env('POSTGRES_PASSWORD'),
    database: 'postgres',
  });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${DB}" OWNER tm_migrator`);
  created = true;
  url.pathname = `/${DB}`;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  expect((await db.query('SELECT current_database() d')).rows[0].d).toBe(DB);
  await db.query(
    `CREATE TABLE _prisma_migrations (id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz, migration_name varchar(255) not null, logs text, rolled_back_at timestamptz, started_at timestamptz not null default now(), applied_steps_count integer not null default 0)`,
  );
  const all = readdirSync(ROOT)
    .filter((n) => /^\d{14}_/.test(n))
    .sort();
  if (!all.includes(NAME)) throw new Error('Cost migration missing');
  for (const n of all.slice(0, all.indexOf(NAME)))
    await db.query(readFileSync(join(ROOT, n, 'migration.sql'), 'utf8'));
  await db.query(
    `INSERT INTO tenants (id,name,slug,updated_at) VALUES ($1,'Cost rehearsal',$2,now())`,
    [tenant, `cost-${tenant}`],
  );
  await db.query(
    `INSERT INTO companies (id,tenant_id,legal_name,tax_number,tax_office,address_line,district,city,updated_at) VALUES ($1,$2,'C','1234567890','T','A','D','C',now())`,
    [company, tenant],
  );
  await db.query(
    `INSERT INTO products (id,tenant_id,company_id,name,updated_at) VALUES ($1,$2,$3,'P',now())`,
    [product, tenant, company],
  );
  await db.query(
    `INSERT INTO product_variants (id,tenant_id,company_id,product_id,sku,updated_at) VALUES ($1,$2,$3,$4,'COST',now())`,
    [variant, tenant, company, product],
  );
  before = await columns();
  await db.query(sql('migration.sql'));
}, 180000);

afterAll(async () => {
  await db?.end();
  if (admin) {
    if (created) await admin.query(`DROP DATABASE "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});

describe('purchase cost additive migration', () => {
  it('preserves an old variant with unknown cost and passes verify.sql', async () => {
    expect(
      (
        await db.query(
          `SELECT id,sku,purchase_cost,cost_currency,purchase_cost_updated_at FROM product_variants WHERE id=$1`,
          [variant],
        )
      ).rows,
    ).toEqual([
      {
        id: variant,
        sku: 'COST',
        purchase_cost: null,
        cost_currency: null,
        purchase_cost_updated_at: null,
      },
    ]);
    const checks = await db.query(sql('verify.sql'));
    for (const result of checks as unknown as pg.QueryResult[])
      expect(Object.values(result.rows[0])[1]).toBe('t');
  });

  it('enforces nonnegative finite costs, currency and three-field consistency', async () => {
    for (const set of [
      "purchase_cost=-1,cost_currency='TRY',purchase_cost_updated_at=now()",
      "purchase_cost='NaN',cost_currency='TRY',purchase_cost_updated_at=now()",
      'purchase_cost=1',
      "cost_currency='TRY'",
      "purchase_cost=1,cost_currency='GBP',purchase_cost_updated_at=now()",
      "purchase_cost=1,cost_currency='TRY'",
    ]) {
      await expect(
        db.query(`UPDATE product_variants SET ${set} WHERE id=$1`, [variant]),
      ).rejects.toMatchObject({ code: '23514' });
    }
    await db.query(
      `UPDATE product_variants SET purchase_cost=0,cost_currency='TRY',purchase_cost_updated_at=now() WHERE id=$1`,
      [variant],
    );
    expect(
      (
        await db.query(
          `SELECT purchase_cost::text a FROM product_variants WHERE id=$1`,
          [variant],
        )
      ).rows[0].a,
    ).toBe('0.00');
  });

  it('refuses a populated rollback without losing the cost', async () => {
    await expect(db.query(sql('down.sql'))).rejects.toThrow(
      'Purchase cost records exist',
    );
    await db.query('ROLLBACK');
    expect(
      (
        await db.query(
          `SELECT purchase_cost::text a FROM product_variants WHERE id=$1`,
          [variant],
        )
      ).rows[0].a,
    ).toBe('0.00');
  });

  it('restores the original columns and existing rows when no cost is populated, then reapplies', async () => {
    await db.query(
      `UPDATE product_variants SET purchase_cost=null,cost_currency=null,purchase_cost_updated_at=null WHERE id=$1`,
      [variant],
    );
    await db.query(sql('down.sql'));
    expect(await columns()).toEqual(before);
    expect(
      (
        await db.query(`SELECT sku FROM product_variants WHERE id=$1`, [
          variant,
        ])
      ).rows[0].sku,
    ).toBe('COST');
    await db.query(sql('migration.sql'));
    expect((await columns()).length).toBe(before.length + 3);
  });
});
