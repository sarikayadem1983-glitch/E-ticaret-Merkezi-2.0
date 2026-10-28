import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { appPool, ownerPool } from './helpers.js';

/**
 * Verifies the least-privilege contract of the application role (tm_app)
 * directly against PostgreSQL, bypassing every application-level guard.
 */
describe('Database privileges (e2e)', () => {
  let app: pg.Pool;
  let owner: pg.Pool;
  let tenantId: string;
  const slug = `priv-${randomUUID().slice(0, 8)}`;

  const denied =
    /permission denied|must be owner|insufficient_privilege|append-only/;

  beforeAll(async () => {
    app = appPool();
    owner = ownerPool();
    const { rows } = await app.query<{ id: string }>(
      "INSERT INTO tenants (id, name, slug, updated_at) VALUES (gen_random_uuid(), 'Yetki', $1, now()) RETURNING id",
      [slug],
    );
    tenantId = rows[0].id;
    await app.query(
      "INSERT INTO audit_logs (id, tenant_id, action, module, entity_type) VALUES (gen_random_uuid(), $1, 'CREATE', 'test', 'Tenant')",
      [tenantId],
    );
  });

  afterAll(async () => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.allow_audit_purge = 'on'");
      await client.query('DELETE FROM audit_logs WHERE tenant_id = $1', [
        tenantId,
      ]);
      await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await app.end();
    await owner.end();
  });

  describe('role attributes', () => {
    it('app role is not superuser, cannot create roles/dbs or bypass RLS', async () => {
      const { rows } = await app.query(
        `SELECT current_user AS role, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication
         FROM pg_roles WHERE rolname = current_user`,
      );
      expect(rows[0]).toEqual({
        role: 'tm_app',
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolbypassrls: false,
        rolreplication: false,
      });
    });

    it('app role owns no schema, table, type or function', async () => {
      const { rows } = await app.query(
        `SELECT
           (SELECT count(*) FROM pg_namespace WHERE nspowner = r.oid)::int AS schemas,
           (SELECT count(*) FROM pg_class WHERE relowner = r.oid)::int AS relations,
           (SELECT count(*) FROM pg_type WHERE typowner = r.oid)::int AS types,
           (SELECT count(*) FROM pg_proc WHERE proowner = r.oid)::int AS functions
         FROM pg_roles r WHERE r.rolname = current_user`,
      );
      expect(rows[0]).toEqual({
        schemas: 0,
        relations: 0,
        types: 0,
        functions: 0,
      });
    });
  });

  describe('audit_logs', () => {
    it('app role can INSERT and SELECT', async () => {
      const { rows } = await app.query(
        'SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1',
        [tenantId],
      );
      expect(rows[0].n).toBe(1);
    });

    it.each([
      ['UPDATE', "UPDATE audit_logs SET module = 'x' WHERE tenant_id = $1"],
      ['DELETE', 'DELETE FROM audit_logs WHERE tenant_id = $1'],
    ])('app role cannot %s', async (_op, sql) => {
      await expect(app.query(sql, [tenantId])).rejects.toThrow(denied);
    });

    it('app role cannot TRUNCATE', async () => {
      await expect(app.query('TRUNCATE audit_logs')).rejects.toThrow(denied);
    });

    it('app role cannot use the purge flag to delete', async () => {
      const client = await app.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL app.allow_audit_purge = 'on'");
        await expect(
          client.query('DELETE FROM audit_logs WHERE tenant_id = $1', [
            tenantId,
          ]),
        ).rejects.toThrow(denied);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it.each([
      'ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update_delete',
      'ALTER TABLE audit_logs DISABLE TRIGGER ALL',
      'DROP TRIGGER audit_logs_no_update_delete ON audit_logs',
      "CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN OLD; END'",
      'DROP TABLE audit_logs',
      "SET session_replication_role = 'replica'",
    ])('app role cannot tamper: %s', async (sql) => {
      await expect(app.query(sql)).rejects.toThrow(denied);
    });

    it('owner purge works only with the flag (retention path)', async () => {
      await expect(
        owner.query('DELETE FROM audit_logs WHERE tenant_id = $1', [tenantId]),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('schema and migrations', () => {
    it.each([
      'CREATE TABLE evil (id int)',
      'CREATE FUNCTION evil() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
      'ALTER TABLE users ADD COLUMN evil int',
      'DROP TABLE users',
      'TRUNCATE users',
      'CREATE SCHEMA evil',
    ])('app role cannot run DDL: %s', async (sql) => {
      await expect(app.query(sql)).rejects.toThrow(denied);
    });

    it('app role cannot read or modify _prisma_migrations', async () => {
      await expect(
        app.query('SELECT * FROM _prisma_migrations'),
      ).rejects.toThrow(denied);
    });

    it('GRANT from the app role has no effect', async () => {
      await app
        .query('GRANT UPDATE ON audit_logs TO tm_app')
        .catch(() => undefined);
      await expect(
        app.query("UPDATE audit_logs SET module = 'x' WHERE tenant_id = $1", [
          tenantId,
        ]),
      ).rejects.toThrow(denied);
    });
  });
});
