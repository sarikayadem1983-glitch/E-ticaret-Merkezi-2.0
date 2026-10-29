/**
 * Phase 1 of the user-management migration, rehearsed on a throwaway database.
 * Never touches the development database: a fresh `tm_migration_test_*` database
 * is created (as the Postgres superuser), migrated as tm_migrator, and dropped.
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: '../.env', quiet: true });

const ROOT = join(process.cwd(), '..', 'database');
const MIGRATIONS = join(ROOT, 'prisma', 'migrations');
const VERIFY = join(ROOT, 'migrations-verify', '20261029090000');
const PHASE1 = '20261029090000_tenant_memberships';
const BASELINE = '20261028140000_companies';
const TEST_DB = `tm_migration_test_${process.pid}`;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Refuses anything that is not a local, throwaway tm_* database. */
function assertSafeTarget(url: URL): void {
  const db = url.pathname.replace(/^\//, '');
  const devDb = new URL(env('MIGRATION_DATABASE_URL')).pathname.replace(/^\//, '');
  if (!db.startsWith('tm_migration_test')) throw new Error(`unsafe database name: ${db}`);
  if (db === devDb || db === process.env.POSTGRES_DB) throw new Error('refusing the development database');
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error(`unsafe host: ${url.hostname}`);
}

function urlFor(base: string): URL {
  const url = new URL(base);
  url.pathname = `/${TEST_DB}`;
  assertSafeTarget(url);
  return url;
}

let client: pg.Client;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await client.query(sql, params)).rows as T[];
}

const read = (path: string) => readFileSync(path, 'utf8');
const migrationSql = (name: string) => read(join(MIGRATIONS, name, 'migration.sql'));

async function run(file: string): Promise<{ check_name: string; ok: boolean; detail: string }[]> {
  const result = await client.query(read(join(VERIFY, file)));
  const last = Array.isArray(result) ? result[result.length - 1] : result;
  return last.rows;
}

async function applyPhase1(): Promise<void> {
  await client.query(migrationSql(PHASE1));
}

async function columnNullable(table: string, column: string): Promise<boolean> {
  const rows = await q<{ is_nullable: string }>(
    'select is_nullable from information_schema.columns where table_name=$1 and column_name=$2',
    [table, column],
  );
  return rows[0].is_nullable === 'YES';
}

/** Runs `fn` in a transaction that is always rolled back. */
async function inRollback(fn: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

const tenantA = randomUUID();
const tenantB = randomUUID();
const ownerA = randomUUID();
const passiveId = randomUUID();
const ownerB = randomUUID();
const companyA = randomUUID();
const companyA2 = randomUUID();
let ownerRoleId = '';
let accountingRoleId = '';

async function seed(): Promise<void> {
  await q(
    `insert into tenants (id, name, slug, updated_at) values ($1,'A','a',now()), ($2,'B','b',now())`,
    [tenantA, tenantB],
  );
  await q(
    `insert into users (id, tenant_id, name, email, password_hash, is_active, updated_at) values
      ($1,$4,'Owner A','owner-a@example.com','hash-a',true,now()),
      ($2,$4,'Ayşe','Ayse@Example.com','hash-ayse',false,now()),
      ($3,$5,'Owner B','owner-b@example.com','hash-b',true,now())`,
    [ownerA, passiveId, ownerB, tenantA, tenantB],
  );
  const roles = await q<{ id: string; tenant_id: string; name: string }>(
    `insert into roles (id, tenant_id, name, permissions, updated_at) values
      (gen_random_uuid(),$1,'owner','{*}',now()),
      (gen_random_uuid(),$1,'accounting','{companies:read}',now()),
      (gen_random_uuid(),$2,'owner','{*}',now())
     returning id, tenant_id, name`,
    [tenantA, tenantB],
  );
  ownerRoleId = roles.find((r) => r.tenant_id === tenantA && r.name === 'owner')!.id;
  accountingRoleId = roles.find((r) => r.name === 'accounting')!.id;
  const ownerRoleB = roles.find((r) => r.tenant_id === tenantB)!.id;
  await q(
    `insert into user_roles (tenant_id, user_id, role_id, updated_at) values ($1,$2,$3,now()), ($4,$5,$6,now())`,
    [tenantA, ownerA, ownerRoleId, tenantB, ownerB, ownerRoleB],
  );
  await q(
    `insert into companies (id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, updated_at) values
      ($1,$3,'A Ltd','1234567890','Kadıköy','Adres','Kadıköy','İstanbul',now()),
      ($2,$3,'A2 Ltd','1234567891','Kadıköy','Adres','Kadıköy','İstanbul',now())`,
    [companyA, companyA2, tenantA],
  );
  await q(`insert into user_company_roles (tenant_id, user_id, company_id, role_id) values ($1,$2,$3,$4)`, [
    tenantA,
    passiveId,
    companyA,
    accountingRoleId,
  ]);
  await q(
    `insert into refresh_tokens (id, tenant_id, user_id, token_hash, expires_at, updated_at)
     values (gen_random_uuid(),$1,$2,'rt-hash',now() + interval '1 day',now())`,
    [tenantA, ownerA],
  );
  await q(
    `insert into audit_logs (id, tenant_id, actor_user_id, action, module, entity_type)
     values (gen_random_uuid(),$1,$2,'LOGIN','auth','user')`,
    [tenantA, ownerA],
  );
}

let admin: pg.Client;
let phase1Ms = 0;
const exclusiveLocks: string[] = [];

beforeAll(async () => {
  // Superuser on the maintenance database: only CREATE/DROP of the throwaway database.
  const target = urlFor(env('MIGRATION_DATABASE_URL'));
  admin = new pg.Client({
    host: target.hostname,
    port: Number(target.port || 5432),
    user: env('POSTGRES_USER'),
    password: env('POSTGRES_PASSWORD'),
    database: 'postgres',
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
  await admin.query(`CREATE DATABASE "${TEST_DB}" OWNER tm_migrator`);

  client = new pg.Client({ connectionString: urlFor(env('MIGRATION_DATABASE_URL')).toString() });
  await client.connect();
  const [{ db }] = await q<{ db: string }>('select current_database() as db');
  if (db !== TEST_DB) throw new Error(`connected to ${db}, expected ${TEST_DB}`);

  const all = readdirSync(MIGRATIONS).filter((n) => /^\d{14}_/.test(n)).sort();
  // Same shape as Prisma's own bookkeeping table (earlier migrations reference it).
  await q(`create table _prisma_migrations (
    id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz,
    migration_name varchar(255) not null, logs text, rolled_back_at timestamptz,
    started_at timestamptz not null default now(), applied_steps_count integer not null default 0)`);
  for (const name of all.slice(0, all.indexOf(BASELINE) + 1)) {
    await client.query(migrationSql(name));
    await q(
      `insert into _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
       values (gen_random_uuid()::text, 'test', now(), $1, 1)`,
      [name],
    );
  }
  await seed();
  await run('snapshot-before.sql');

  // Lock rehearsal: apply inside a transaction, list ACCESS EXCLUSIVE locks, roll back.
  await client.query('BEGIN');
  await applyPhase1();
  const locks = await q<{ rel: string }>(
    `select c.relname as rel from pg_locks l join pg_class c on c.oid = l.relation
     where l.pid = pg_backend_pid() and l.mode = 'AccessExclusiveLock' and c.relnamespace = 'public'::regnamespace
     order by 1`,
  );
  exclusiveLocks.push(...locks.map((l) => l.rel));
  await client.query('ROLLBACK');

  const started = performance.now();
  await applyPhase1();
  phase1Ms = performance.now() - started;
  console.log(`phase 1 migration: ${phase1Ms.toFixed(1)} ms; ACCESS EXCLUSIVE on: ${exclusiveLocks.join(', ')}`);
}, 60_000);

afterAll(async () => {
  await client?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await admin.end();
  }
});

describe('phase 1 migration (tenant memberships)', () => {
  it('phase 1 keeps every user–tenant–role mapping', async () => {
    const rows = await run('verify-after.sql');
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
  });

  it('creates one membership per user with the same status', async () => {
    expect(await q('select status from tenant_memberships where user_id=$1', [passiveId])).toEqual([
      { status: 'inactive' },
    ]);
    expect(await q('select count(*)::int as n from tenant_memberships')).toEqual([{ n: 3 }]);
  });

  it('normalizes emails and keeps tenant_id values', async () => {
    expect(await q('select email, tenant_id, last_tenant_id from users where id=$1', [passiveId])).toEqual([
      { email: 'ayse@example.com', tenant_id: tenantA, last_tenant_id: tenantA },
    ]);
    expect(await columnNullable('users', 'tenant_id')).toBe(true);
  });

  it('creates the five system roles per tenant and maps existing ones', async () => {
    const rows = await q<{ key: string; scope: string; is_system: boolean }>(
      'select key, scope, is_system from roles where tenant_id=$1 order by key',
      [tenantA],
    );
    expect(rows).toEqual([
      { key: 'accounting', scope: 'company', is_system: true },
      { key: 'admin', scope: 'tenant', is_system: true },
      { key: 'operations', scope: 'company', is_system: true },
      { key: 'owner', scope: 'tenant', is_system: true },
      { key: 'viewer', scope: 'company', is_system: true },
    ]);
    expect(await q('select id from roles where tenant_id=$1 and key=$2', [tenantA, 'accounting'])).toEqual([
      { id: accountingRoleId },
    ]);
  });

  it('grants tm_app SELECT/INSERT/UPDATE but not DELETE on the new tables', async () => {
    const rows = await q<{ t: string; s: boolean; i: boolean; u: boolean; d: boolean }>(
      `select t, has_table_privilege('tm_app', t, 'SELECT') s, has_table_privilege('tm_app', t, 'INSERT') i,
              has_table_privilege('tm_app', t, 'UPDATE') u, has_table_privilege('tm_app', t, 'DELETE') d
       from unnest(array['tenant_memberships','invitations']) t order by t`,
    );
    expect(rows).toEqual([
      { t: 'invitations', s: true, i: true, u: true, d: false },
      { t: 'tenant_memberships', s: true, i: true, u: true, d: false },
    ]);
  });

  it('adds the new audit actions', async () => {
    const rows = await q<{ v: string }>(`select unnest(enum_range(null::audit_action))::text as v`);
    expect(rows.map((r) => r.v)).toEqual(
      expect.arrayContaining(['INVITATION_CREATED', 'MEMBERSHIP_DEACTIVATED', 'ROLE_CHANGED', 'TENANT_SWITCH']),
    );
  });

  it('rejects an owner role in user_company_roles', async () => {
    await expect(
      inRollback(() =>
        q('insert into user_company_roles (tenant_id,user_id,company_id,role_id) values ($1,$2,$3,$4)', [
          tenantA,
          ownerA,
          companyA2,
          ownerRoleId,
        ]).then(() => undefined),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('rejects a company role in user_roles', async () => {
    await expect(
      inRollback(() =>
        q('insert into user_roles (tenant_id,user_id,role_id,updated_at) values ($1,$2,$3,now())', [
          tenantA,
          passiveId,
          accountingRoleId,
        ]).then(() => undefined),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('rejects a role for someone without a membership', async () => {
    await expect(
      inRollback(() =>
        q('insert into user_roles (tenant_id,user_id,role_id,updated_at) values ($1,$2,$3,now())', [
          tenantA,
          ownerB,
          ownerRoleId,
        ]).then(() => undefined),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('lets one user hold memberships in two tenants', async () => {
    await inRollback(async () => {
      await q(`insert into tenant_memberships (tenant_id,user_id,status,updated_at) values ($1,$2,'active',now())`, [
        tenantB,
        ownerA,
      ]);
      expect(await q('select count(*)::int as n from tenant_memberships where user_id=$1', [ownerA])).toEqual([
        { n: 2 },
      ]);
    });
  });

  it('allows different roles in different companies but only one role per company', async () => {
    await inRollback(async () => {
      const [{ id: operations }] = await q<{ id: string }>(
        `select id from roles where tenant_id=$1 and key='operations'`,
        [tenantA],
      );
      await q('insert into user_company_roles (tenant_id,user_id,company_id,role_id) values ($1,$2,$3,$4)', [
        tenantA,
        passiveId,
        companyA2,
        operations,
      ]);
      await expect(
        q('insert into user_company_roles (tenant_id,user_id,company_id,role_id) values ($1,$2,$3,$4)', [
          tenantA,
          passiveId,
          companyA,
          operations,
        ]),
      ).rejects.toThrow(/user_company_roles_tenant_id_user_id_company_id_key/);
    });
  });

  it('allows only one pending invitation per tenant and email', async () => {
    await inRollback(async () => {
      const insert = (hash: string) =>
        q(
          `insert into invitations (id,tenant_id,email,token_hash,expires_at,invited_by_user_id,updated_at)
           values (gen_random_uuid(),$1,'new@example.com',$2,now() + interval '1 day',$3,now())`,
          [tenantA, hash, ownerA],
        );
      await insert('h1');
      await expect(insert('h2')).rejects.toThrow(/invitations_tenant_id_email_pending_key/);
    });
  });

  it('fails safely when phase 1 runs a second time', async () => {
    await expect(applyPhase1()).rejects.toThrow();
    const rows = await run('verify-after.sql');
    expect(rows.filter((r) => !r.ok)).toEqual([]);
  });

  it('SQL-only constraints exist after migration', async () => {
    const generated = await q<{ t: string }>(
      `select table_name as t from information_schema.columns
       where column_name='role_scope' and is_generated='ALWAYS' order by 1`,
    );
    expect(generated.map((r) => r.t)).toEqual(['user_company_roles', 'user_roles']);
    const constraints = await q<{ n: string }>(
      `select conname as n from pg_constraint where conname = any($1) and convalidated order by 1`,
      [
        [
          'invitations_email_lowercase',
          'user_company_roles_tenant_id_role_id_role_scope_fkey',
          'user_roles_tenant_id_role_id_role_scope_fkey',
        ],
      ],
    );
    expect(constraints.map((r) => r.n)).toEqual([
      'invitations_email_lowercase',
      'user_company_roles_tenant_id_role_id_role_scope_fkey',
      'user_roles_tenant_id_role_id_role_scope_fkey',
    ]);
    const partial = await q<{ n: string }>(
      `select i.relname as n from pg_index x join pg_class i on i.oid = x.indexrelid
       where x.indisunique and x.indpred is not null and i.relname = any($1) order by 1`,
      [['invitations_tenant_id_email_pending_key', 'roles_tenant_id_key_key']],
    );
    expect(partial.map((r) => r.n)).toEqual(['invitations_tenant_id_email_pending_key', 'roles_tenant_id_key_key']);
  });

  it('rollback stops when a user has memberships in two tenants', async () => {
    await q(`insert into tenant_memberships (tenant_id,user_id,status,updated_at) values ($1,$2,'active',now())`, [
      tenantB,
      ownerA,
    ]);
    await expect(run('rollback.sql')).rejects.toThrow(/birden fazla tenant/);
    await client.query('ROLLBACK'); // rollback.sql opened its own transaction
    expect(await q(`select to_regclass('tenant_memberships') as t`)).toEqual([{ t: 'tenant_memberships' }]);
    await q('delete from tenant_memberships where tenant_id=$1 and user_id=$2', [tenantB, ownerA]);
  });

  it('rollback carries a post-deploy deactivation back to users.is_active', async () => {
    await q(`update tenant_memberships set status='inactive', deactivated_at=now() where user_id=$1`, [ownerB]);
    await run('rollback.sql');
    expect(await q('select is_active from users where id=$1', [ownerB])).toEqual([{ is_active: false }]);
    // Restore the snapshot state so the re-apply check below compares like with like.
    await q('update users set is_active=true where id=$1', [ownerB]);
  });

  it('rollback.sql restores the previous schema', async () => {
    expect(await columnNullable('users', 'tenant_id')).toBe(false);
    expect(await q(`select to_regclass('tenant_memberships') as t, to_regclass('invitations') as i`)).toEqual([
      { t: null, i: null },
    ]);
    expect(await q('select count(*)::int as n from users')).toEqual([{ n: 3 }]);
    expect(await q('select count(*)::int as n from user_company_roles')).toEqual([{ n: 1 }]);
  });

  it('stops when two emails differ only by case', async () => {
    await q(
      `insert into users (id, tenant_id, name, email, password_hash, updated_at)
       values (gen_random_uuid(),$1,'Dup','AYSE@example.com','x',now())`,
      [tenantB],
    );
    await expect(applyPhase1()).rejects.toThrow(/email çakışması/);
    expect(await q(`select count(*)::int as n from users where email='AYSE@example.com'`)).toEqual([{ n: 1 }]);
    expect(await q(`select to_regclass('tenant_memberships') as t`)).toEqual([{ t: null }]);
    await q(`delete from users where email='AYSE@example.com'`);
  });

  it('stops when a user has two roles in the same company', async () => {
    await q('insert into user_company_roles (tenant_id,user_id,company_id,role_id) values ($1,$2,$3,$4)', [
      tenantA,
      passiveId,
      companyA,
      ownerRoleId,
    ]);
    await expect(applyPhase1()).rejects.toThrow(/aynı firmada birden fazla rol/);
    await q('delete from user_company_roles where role_id=$1', [ownerRoleId]);
  });

  it('can be applied again after rollback', async () => {
    await applyPhase1();
    const rows = await run('verify-after.sql');
    expect(rows.filter((r) => !r.ok)).toEqual([]);
  });
});
