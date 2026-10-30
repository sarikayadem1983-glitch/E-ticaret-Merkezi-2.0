import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AccessService } from './../src/access/access.service.js';
import { AccountsService } from './../src/auth/accounts.service.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { MailDeliveryError } from './../src/mail/mail.errors.js';
import {
  MAIL_TRANSPORT,
  type MailTransport,
  type OutgoingMail,
} from './../src/mail/mail.transport.js';
import {
  createTestApp,
  ownerPool,
  purgeTenants,
  RELAXED_RATE_LIMITS,
  seedMember,
} from './helpers.js';

const PASSWORD = 'Correct-Horse-9';

/** Captures mail instead of sending it; `failNext` simulates an SMTP outage. */
class FakeTransport implements MailTransport {
  sent: OutgoingMail[] = [];
  failNext = false;

  send(mail: OutgoingMail): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new MailDeliveryError('SMTP_UNAVAILABLE'));
    }
    this.sent.push(mail);
    return Promise.resolve();
  }

  /** Token from the latest mail to `to`. */
  tokenFor(to: string): string {
    const mail = this.sent.filter((m) => m.to === to).at(-1);
    const token = mail?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error(`no invitation mail for ${to}`);
    return token;
  }
}

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}
let seq = 0;
const uniqueVkn = () =>
  vkn(
    String(Date.now() % 1e6).padStart(6, '0') + String(seq++).padStart(3, '0'),
  );

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = ownerPool();
  try {
    return (await pool.query(text, params)).rows as T[];
  } finally {
    await pool.end();
  }
}

describe('Invitations (e2e)', () => {
  let app: INestApplication<App>;
  const mail = new FakeTransport();
  const run = randomUUID().slice(0, 8);
  const slugs = [`inv-a-${run}`, `inv-b-${run}`];
  const email = (label: string) => `${label}-${run}@test.local`;
  let ownerA: string;
  let ownerB: string;
  let adminA: string;
  let opsA: string;
  let tenantA: string;
  let tenantB: string;
  let adminAId: string;
  let companyA1: string;
  let companyA2: string;
  let companyB: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const register = async (slug: string) =>
    (
      await http()
        .post('/api/v1/auth/register')
        .send({
          tenantName: `Mağaza ${slug}`,
          tenantSlug: slug,
          name: 'Sahip',
          email: `${slug}@test.local`,
          password: PASSWORD,
        })
        .expect(201)
    ).body.data.accessToken as string;

  const login = async (address: string, password = PASSWORD) =>
    (
      await http()
        .post('/api/v1/auth/login')
        .send({ email: address, password })
        .expect(200)
    ).body.data.accessToken as string;

  const tenantOf = async (token: string) =>
    (await http().get('/api/v1/auth/me').set(bearer(token)).expect(200)).body
      .data.tenantId as string;

  const company = async (token: string) =>
    (
      await http()
        .post('/api/v1/companies')
        .set(bearer(token))
        .send({
          legalName: `Firma ${seq}`,
          taxNumber: uniqueVkn(),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
        })
        .expect(201)
    ).body.data.id as string;

  const invite = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/invitations').set(bearer(token)).send(body);

  const inviteCompany = (token: string, to: string, companyId = companyA1) =>
    invite(token, {
      email: to,
      companyRoles: [{ companyId, roleKey: 'accounting' }],
    });

  const lookup = (token: string) =>
    http().post('/api/v1/invitations/lookup').send({ token });

  const accept = (token: string, body: Record<string, unknown> = {}) =>
    http()
      .post('/api/v1/invitations/accept')
      .send({ token, name: 'Davetli', password: PASSWORD, ...body });

  const roleId = async (tenantId: string, key: string) =>
    (
      await sql<{ id: string }>(
        'SELECT id FROM roles WHERE tenant_id = $1 AND key = $2',
        [tenantId, key],
      )
    )[0].id;

  beforeAll(async () => {
    app = await createTestApp(
      {},
      { providers: [{ provide: MAIL_TRANSPORT, useValue: mail }] },
    );
    ownerA = await register(slugs[0]);
    ownerB = await register(slugs[1]);
    tenantA = await tenantOf(ownerA);
    tenantB = await tenantOf(ownerB);
    companyA1 = await company(ownerA);
    companyA2 = await company(ownerA);
    companyB = await company(ownerB);

    const passwordHash = await hash(PASSWORD);
    adminAId = await seedMember({
      email: email('admin'),
      name: 'Yönetici',
      passwordHash,
      memberships: [
        { tenantId: tenantA, roleId: await roleId(tenantA, 'admin') },
      ],
    });
    adminA = await login(email('admin'));
    const opsId = await seedMember({
      email: email('ops'),
      name: 'Operasyon',
      passwordHash,
      memberships: [{ tenantId: tenantA }],
    });
    await sql(
      `INSERT INTO user_company_roles (tenant_id, user_id, company_id, role_id)
       VALUES ($1, $2, $3, $4)`,
      [tenantA, opsId, companyA1, await roleId(tenantA, 'operations')],
    );
    opsA = await login(email('ops'));
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  describe('create', () => {
    it('creates a pending invitation and mails a link', async () => {
      const to = email('new1');
      const res = await inviteCompany(ownerA, to).expect(201);
      expect(res.body.data).toEqual({
        id: expect.any(String),
        status: 'pending',
        delivery: 'sent',
        replacesInactiveMembership: false,
      });
      expect(mail.tokenFor(to)).toBeTruthy();
    });

    it('stores only the token hash', async () => {
      const to = email('hash');
      const { id } = (await inviteCompany(ownerA, to).expect(201)).body.data;
      const token = mail.tokenFor(to);
      const [row] = await sql<Record<string, unknown>>(
        'SELECT * FROM invitations WHERE id = $1',
        [id],
      );
      expect(row.token_hash).toBe(sha256(token));
      expect(JSON.stringify(row)).not.toContain(token);
      const audit = await sql(
        `SELECT before, after FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2`,
        [tenantA, id],
      );
      expect(audit.length).toBeGreaterThan(0);
      expect(JSON.stringify(audit)).not.toContain(token);
    });

    it('email failure keeps the invitation pending with delivery failed', async () => {
      mail.failNext = true;
      const res = await inviteCompany(ownerA, email('smtpdown')).expect(201);
      expect(res.body.data).toMatchObject({
        status: 'pending',
        delivery: 'failed',
      });
      const [row] = await sql<{
        status: string;
        send_attempts: number;
        last_send_error: string;
        last_sent_at: Date | null;
      }>(
        'SELECT status, send_attempts, last_send_error, last_sent_at FROM invitations WHERE id = $1',
        [res.body.data.id],
      );
      expect(row).toMatchObject({
        status: 'pending',
        send_attempts: 1,
        last_send_error: 'SMTP_UNAVAILABLE',
        last_sent_at: null,
      });
    });

    it('owner invites an admin', async () => {
      await invite(ownerA, {
        email: email('newadmin'),
        tenantRole: 'admin',
      }).expect(201);
    });

    it('admin cannot invite an admin', async () => {
      const res = await invite(adminA, {
        email: email('x-admin'),
        tenantRole: 'admin',
      }).expect(403);
      expect(res.body.error.code).toBe('ROLE_NOT_GRANTABLE');
    });

    it('nobody invites an owner', async () => {
      await invite(ownerA, {
        email: email('x-owner'),
        tenantRole: 'owner',
      }).expect(422);
      await invite(ownerA, {
        email: email('x-owner2'),
        companyRoles: [{ companyId: companyA1, roleKey: 'owner' }],
      }).expect(422);
    });

    it('admin invites company roles', async () => {
      await inviteCompany(adminA, email('by-admin')).expect(201);
    });

    it('a company-role member cannot invite', async () => {
      await inviteCompany(opsA, email('by-ops')).expect(403);
    });

    it('company roles need at least one company', async () => {
      const res = await invite(ownerA, {
        email: email('nocompany'),
        companyRoles: [],
      }).expect(400);
      expect(res.body.error.code).toBe('COMPANY_REQUIRED');
    });

    it('needs exactly one of tenantRole and companyRoles', async () => {
      await invite(ownerA, {
        email: email('both'),
        tenantRole: 'admin',
        companyRoles: [{ companyId: companyA1, roleKey: 'viewer' }],
      }).expect(400);
      await invite(ownerA, { email: email('neither') }).expect(400);
    });

    it("refuses another tenant's company with 404", async () => {
      const res = await inviteCompany(
        ownerA,
        email('foreign'),
        companyB,
      ).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('refuses an inactive company', async () => {
      const c = await company(ownerA);
      await http()
        .post(`/api/v1/companies/${c}/deactivate`)
        .set(bearer(ownerA))
        .expect(200);
      await inviteCompany(ownerA, email('inactive-co'), c).expect(404);
    });

    it('refuses a second pending invitation and an active member', async () => {
      const to = email('dup');
      await inviteCompany(ownerA, to).expect(201);
      expect(
        (await inviteCompany(ownerA, to).expect(409)).body.error.code,
      ).toBe('INVITATION_PENDING');
      expect(
        (await inviteCompany(ownerA, email('admin')).expect(409)).body.error
          .code,
      ).toBe('ALREADY_MEMBER');
    });

    it('refuses an inactive member in the MVP', async () => {
      await seedMember({
        email: email('gone'),
        name: 'Eski',
        passwordHash: await hash(PASSWORD),
        memberships: [{ tenantId: tenantA, status: 'inactive' }],
      });
      expect(
        (await inviteCompany(ownerA, email('gone')).expect(409)).body.error
          .code,
      ).toBe('MEMBERSHIP_INACTIVE');
    });

    it('never reveals whether an email exists in another tenant', async () => {
      const known = await inviteCompany(
        ownerA,
        `${slugs[1]}@test.local`,
      ).expect(201);
      const unknown = await inviteCompany(ownerA, email('nobody')).expect(201);
      expect(Object.keys(known.body.data).sort()).toEqual(
        Object.keys(unknown.body.data).sort(),
      );
      expect({ ...known.body.data, id: '' }).toEqual({
        ...unknown.body.data,
        id: '',
      });
    });

    it('writes INVITATION_CREATED to the audit log', async () => {
      const { id } = (await inviteCompany(ownerA, email('audit')).expect(201))
        .body.data;
      const rows = await sql<{ action: string; actor_user_id: string }>(
        'SELECT action, actor_user_id FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2',
        [tenantA, id],
      );
      expect(rows.map((r) => r.action)).toEqual(['INVITATION_CREATED']);
    });
  });

  describe('list, resend and revoke', () => {
    it('lists pending invitations of the own tenant only', async () => {
      const to = email('listed');
      await inviteCompany(ownerA, to).expect(201);
      const a = await http()
        .get('/api/v1/invitations')
        .set(bearer(ownerA))
        .expect(200);
      expect(a.body.data.map((i: { email: string }) => i.email)).toContain(to);
      expect(JSON.stringify(a.body)).not.toMatch(/token/i);
      const b = await http()
        .get('/api/v1/invitations')
        .set(bearer(ownerB))
        .expect(200);
      expect(b.body.data.map((i: { email: string }) => i.email)).not.toContain(
        to,
      );
    });

    it('resend invalidates the previous link', async () => {
      const to = email('resend');
      const { id } = (await inviteCompany(ownerA, to).expect(201)).body.data;
      const old = mail.tokenFor(to);
      const res = await http()
        .post(`/api/v1/invitations/${id}/resend`)
        .set(bearer(ownerA))
        .expect(200);
      expect(res.body.data).toMatchObject({ id, delivery: 'sent' });
      const fresh = mail.tokenFor(to);
      expect(fresh).not.toBe(old);
      await lookup(old).expect(404);
      await lookup(fresh).expect(200);
      const actions = await sql<{ action: string }>(
        'SELECT action FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2 ORDER BY created_at',
        [tenantA, id],
      );
      expect(actions.map((a) => a.action)).toEqual([
        'INVITATION_CREATED',
        'INVITATION_RESENT',
      ]);
    });

    it('revokes an invitation and writes INVITATION_REVOKED', async () => {
      const to = email('revoke');
      const { id } = (await inviteCompany(ownerA, to).expect(201)).body.data;
      const res = await http()
        .post(`/api/v1/invitations/${id}/revoke`)
        .set(bearer(ownerA))
        .expect(200);
      expect(res.body.data).toMatchObject({ id, status: 'revoked' });
      await http()
        .post(`/api/v1/invitations/${id}/revoke`)
        .set(bearer(ownerA))
        .expect(409);
      const actions = await sql<{ action: string }>(
        'SELECT action FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2 ORDER BY created_at',
        [tenantA, id],
      );
      expect(actions.map((a) => a.action)).toContain('INVITATION_REVOKED');
    });

    it("another tenant cannot see, resend or revoke A's invitation", async () => {
      const { id } = (await inviteCompany(ownerA, email('cross')).expect(201))
        .body.data;
      await http()
        .post(`/api/v1/invitations/${id}/resend`)
        .set(bearer(ownerB))
        .expect(404);
      await http()
        .post(`/api/v1/invitations/${id}/revoke`)
        .set(bearer(ownerB))
        .expect(404);
      const [row] = await sql<{ status: string }>(
        'SELECT status FROM invitations WHERE id = $1',
        [id],
      );
      expect(row.status).toBe('pending');
    });

    it("admin cannot resend or revoke an owner's admin invitation", async () => {
      const { id } = (
        await invite(ownerA, {
          email: email('adm2'),
          tenantRole: 'admin',
        }).expect(201)
      ).body.data;
      await http()
        .post(`/api/v1/invitations/${id}/resend`)
        .set(bearer(adminA))
        .expect(403);
      await http()
        .post(`/api/v1/invitations/${id}/revoke`)
        .set(bearer(adminA))
        .expect(403);
    });

    it('a company-role member cannot list invitations', async () => {
      await http().get('/api/v1/invitations').set(bearer(opsA)).expect(403);
    });
  });

  describe('lookup and accept', () => {
    it('lookup shows the store, inviter, role and a masked email', async () => {
      const to = email('look');
      await inviteCompany(ownerA, to).expect(201);
      const res = await lookup(mail.tokenFor(to)).expect(200);
      expect(res.body.data).toEqual({
        tenantName: `Mağaza ${slugs[0]}`,
        inviterName: 'Sahip',
        roleSummary: expect.stringContaining('Muhasebe'),
        maskedEmail: expect.stringMatching(/^l\*\*\*@test\.local$/),
        accountExists: false,
        replacesInactiveMembership: false,
      });
    });

    it('an unknown token is INVITATION_INVALID', async () => {
      const res = await lookup('x'.repeat(43)).expect(404);
      expect(res.body.error.code).toBe('INVITATION_INVALID');
    });

    it('a new account accepts, gets the company role and can sign in', async () => {
      const to = email('joiner');
      await inviteCompany(ownerA, to).expect(201);
      const res = await accept(mail.tokenFor(to)).expect(200);
      // No token pair, no tenant switch: only where the user joined.
      expect(res.body.data).toEqual({
        tenantId: tenantA,
        tenantName: `Mağaza ${slugs[0]}`,
      });
      const [user] = await sql<{ id: string; email_verified_at: Date | null }>(
        'SELECT id, email_verified_at FROM users WHERE email = $1',
        [to],
      );
      expect(user.email_verified_at).not.toBeNull();
      const token = await login(to);
      const list = await http()
        .get('/api/v1/companies')
        .set(bearer(token))
        .expect(200);
      expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([
        companyA1,
      ]);
      const actions = await sql<{ action: string; actor_user_id: string }>(
        `SELECT action, actor_user_id FROM audit_logs
         WHERE tenant_id = $1 AND actor_user_id = $2 ORDER BY created_at`,
        [tenantA, user.id],
      );
      expect(actions.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'INVITATION_ACCEPTED',
          'MEMBERSHIP_CREATED',
          'COMPANY_ACCESS_CHANGED',
        ]),
      );
    }, 20_000);

    it('an admin invitation grants the admin role', async () => {
      const to = email('admin-joiner');
      await invite(ownerA, { email: to, tenantRole: 'admin' }).expect(201);
      await accept(mail.tokenFor(to)).expect(200);
      const token = await login(to);
      const me = await http().get('/api/v1/auth/me').set(bearer(token));
      expect(me.body.data.tenantId).toBe(tenantA);
      await http().get('/api/v1/invitations').set(bearer(token)).expect(200);
    });

    it('a new account needs a name and a valid password', async () => {
      const to = email('noname');
      await inviteCompany(ownerA, to).expect(201);
      const token = mail.tokenFor(to);
      await accept(token, { name: undefined }).expect(422);
      await accept(token, { password: 'short' }).expect(422);
      await lookup(token).expect(200);
    });

    it('existing account needs token and password', async () => {
      const to = email('existing');
      await seedMember({
        email: to,
        name: 'B Personeli',
        passwordHash: await hash(PASSWORD),
        memberships: [{ tenantId: tenantB }],
      });
      await invite(ownerA, {
        email: to,
        companyRoles: [{ companyId: companyA2, roleKey: 'viewer' }],
      }).expect(201);
      const token = mail.tokenFor(to);
      expect((await lookup(token).expect(200)).body.data.accountExists).toBe(
        true,
      );

      const wrong = await accept(token, {
        password: 'Wrong-Password-1',
      }).expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
      const [pending] = await sql<{ status: string }>(
        'SELECT status FROM invitations WHERE token_hash = $1',
        [sha256(token)],
      );
      expect(pending.status).toBe('pending');

      // The name is ignored for an existing account; the password is checked.
      await accept(token, { name: undefined }).expect(200);
      const [membership] = await sql<{ status: string }>(
        `SELECT m.status FROM tenant_memberships m JOIN users u ON u.id = m.user_id
         WHERE u.email = $1 AND m.tenant_id = $2`,
        [to, tenantA],
      );
      expect(membership.status).toBe('active');
      const [user] = await sql<{
        name: string;
        email_verified_at: Date | null;
      }>('SELECT name, email_verified_at FROM users WHERE email = $1', [to]);
      expect(user).toMatchObject({ name: 'B Personeli' });
      expect(user.email_verified_at).not.toBeNull();
    });

    it('revoked, expired and used tokens all return INVITATION_INVALID', async () => {
      const revokedTo = email('t-revoked');
      const r = (await inviteCompany(ownerA, revokedTo).expect(201)).body.data;
      const revoked = mail.tokenFor(revokedTo);
      await http()
        .post(`/api/v1/invitations/${r.id}/revoke`)
        .set(bearer(ownerA))
        .expect(200);

      const expiredTo = email('t-expired');
      const e = (await inviteCompany(ownerA, expiredTo).expect(201)).body.data;
      const expired = mail.tokenFor(expiredTo);
      await sql(
        "UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = $1",
        [e.id],
      );

      const usedTo = email('t-used');
      await inviteCompany(ownerA, usedTo).expect(201);
      const used = mail.tokenFor(usedTo);
      await accept(used).expect(200);

      for (const token of [revoked, expired, used]) {
        expect((await lookup(token).expect(404)).body.error.code).toBe(
          'INVITATION_INVALID',
        );
        expect((await accept(token).expect(404)).body.error.code).toBe(
          'INVITATION_INVALID',
        );
      }
    });

    it('concurrent accept succeeds once', async () => {
      const to = email('race');
      await inviteCompany(ownerA, to).expect(201);
      const token = mail.tokenFor(to);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => accept(token)),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.every((s) => s === 200 || s === 404 || s === 409)).toBe(
        true,
      );
      const [{ count }] = await sql<{ count: string }>(
        'SELECT count(*) FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1',
        [to],
      );
      expect(Number(count)).toBe(1);
    });

    it("accept re-checks the inviter's current rights", async () => {
      const to = email('inviter-gone');
      await inviteCompany(adminA, to).expect(201);
      await sql(
        "UPDATE tenant_memberships SET status = 'inactive', deactivated_at = now() WHERE tenant_id = $1 AND user_id = $2",
        [tenantA, adminAId],
      );
      try {
        expect(
          (await lookup(mail.tokenFor(to)).expect(404)).body.error.code,
        ).toBe('INVITATION_INVALID');
        expect(
          (await accept(mail.tokenFor(to)).expect(404)).body.error.code,
        ).toBe('INVITATION_INVALID');
      } finally {
        await sql(
          "UPDATE tenant_memberships SET status = 'active', deactivated_at = NULL WHERE tenant_id = $1 AND user_id = $2",
          [tenantA, adminAId],
        );
      }
    });

    it('accept is refused when the inviter was demoted to a company role', async () => {
      const to = email('inviter-demoted');
      await inviteCompany(adminA, to).expect(201);
      const [admin] = await sql<{ role_id: string }>(
        'SELECT role_id FROM user_roles WHERE tenant_id = $1 AND user_id = $2',
        [tenantA, adminAId],
      );
      const [viewer] = await sql<{ id: string }>(
        "SELECT id FROM roles WHERE tenant_id = $1 AND key = 'viewer'",
        [tenantA],
      );
      try {
        // Admin → viewer on one company: may no longer grant any role.
        await sql(
          'DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2',
          [tenantA, adminAId],
        );
        await sql(
          `INSERT INTO user_company_roles (tenant_id, user_id, company_id, role_id)
           VALUES ($1, $2, $3, $4)`,
          [tenantA, adminAId, companyA1, viewer.id],
        );
        expect(
          (await accept(mail.tokenFor(to)).expect(404)).body.error.code,
        ).toBe('INVITATION_INVALID');
        const [row] = await sql<{ status: string }>(
          'SELECT status FROM invitations WHERE token_hash = $1',
          [sha256(mail.tokenFor(to))],
        );
        expect(row.status).toBe('pending');
      } finally {
        await sql(
          'DELETE FROM user_company_roles WHERE tenant_id = $1 AND user_id = $2',
          [tenantA, adminAId],
        );
        await sql(
          'INSERT INTO user_roles (tenant_id, user_id, role_id, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT DO NOTHING',
          [tenantA, adminAId, admin.role_id],
        );
      }
    });

    it('an account created concurrently gives 409 ACCOUNT_EXISTS and keeps the invitation', async () => {
      const to = email('squat-race');
      await inviteCompany(ownerA, to).expect(201);
      const token = mail.tokenFor(to);
      // The account appears between accept's check and its transaction
      // (e.g. another tenant's invitation accepted at the same moment).
      await seedMember({
        email: to,
        name: 'Eş zamanlı',
        passwordHash: await hash(PASSWORD),
        memberships: [{ tenantId: tenantB }],
      });
      const accounts = app.get(AccountsService);
      const spy = vi.spyOn(accounts, 'findByEmail').mockResolvedValueOnce(null);
      try {
        const res = await accept(token).expect(409);
        expect(res.body.error.code).toBe('ACCOUNT_EXISTS');
      } finally {
        spy.mockRestore();
      }
      const [row] = await sql<{ status: string }>(
        'SELECT status FROM invitations WHERE token_hash = $1',
        [sha256(token)],
      );
      expect(row.status).toBe('pending');
      // Retrying as the existing account works.
      await accept(token, { name: undefined }).expect(200);
    });

    it("re-reads the inviter's role inside the accept transaction", async () => {
      const to = email('tx-role');
      await inviteCompany(adminA, to).expect(201);
      const access = app.get(AccessService);
      const spy = vi.spyOn(access, 'tenantRoleKey');
      try {
        await accept(mail.tokenFor(to)).expect(200);
        expect(spy).toHaveBeenCalledWith(adminAId, expect.anything());
      } finally {
        spy.mockRestore();
      }
    });

    it('accept skips inactive companies, and refuses when none is left', async () => {
      const c1 = await company(ownerA);
      const c2 = await company(ownerA);
      const to = email('skip');
      await invite(ownerA, {
        email: to,
        companyRoles: [
          { companyId: c1, roleKey: 'viewer' },
          { companyId: c2, roleKey: 'operations' },
        ],
      }).expect(201);
      const lone = email('lone');
      await inviteCompany(ownerA, lone, c2).expect(201);
      await http()
        .post(`/api/v1/companies/${c2}/deactivate`)
        .set(bearer(ownerA))
        .expect(200);

      await accept(mail.tokenFor(to)).expect(200);
      const rows = await sql<{ company_id: string }>(
        `SELECT r.company_id FROM user_company_roles r JOIN users u ON u.id = r.user_id
         WHERE u.email = $1 AND r.tenant_id = $2`,
        [to, tenantA],
      );
      expect(rows.map((r) => r.company_id)).toEqual([c1]);

      expect(
        (await accept(mail.tokenFor(lone)).expect(404)).body.error.code,
      ).toBe('INVITATION_INVALID');
    });

    it('accept grants nothing before commit', async () => {
      const to = email('rollback');
      await inviteCompany(ownerA, to).expect(201);
      const token = mail.tokenFor(to);
      const access = app.get(AccessService);
      const spy = vi
        .spyOn(access, 'assignCompanyRoles')
        .mockRejectedValueOnce(new Error('injected'));
      try {
        await accept(token).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(
        await sql('SELECT 1 FROM users WHERE email = $1', [to]),
      ).toHaveLength(0);
      const [row] = await sql<{ status: string }>(
        'SELECT status FROM invitations WHERE token_hash = $1',
        [sha256(token)],
      );
      expect(row.status).toBe('pending');
      await accept(token).expect(200);
    });
  });

  it('tenant B owner is still unaffected in B', async () => {
    expect(await tenantOf(ownerB)).toBe(tenantB);
  });
});

describe('Invitations rate limits (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp(
      { TRUST_PROXY: 'loopback' },
      {
        rateLimits: {
          ...RELAXED_RATE_LIMITS,
          invitationLookupPerIp: { limit: 2, windowMs: 60_000 },
          invitationAcceptPerIp: { limit: 2, windowMs: 60_000 },
        },
      },
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each(['lookup', 'accept'])('limits %s per IP', async (path) => {
    // A dedicated forwarded IP keeps this bucket apart from other suites.
    const ip = `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const call = () =>
      request(app.getHttpServer())
        .post(`/api/v1/invitations/${path}`)
        .set('X-Forwarded-For', ip)
        .send({
          token: 'x'.repeat(43),
          ...(path === 'accept' ? { password: PASSWORD } : {}),
        });
    await call().expect(404);
    await call().expect(404);
    await call().expect(429);
  });
});

describe('Invitations: existing-account lockout (e2e)', () => {
  let app: INestApplication<App>;
  const mail = new FakeTransport();
  const run = randomUUID().slice(0, 8);
  const slugs = [`invl-a-${run}`, `invl-b-${run}`];
  const ip = `10.98.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp(
      { TRUST_PROXY: 'loopback' },
      {
        providers: [{ provide: MAIL_TRANSPORT, useValue: mail }],
        rateLimits: {
          ...RELAXED_RATE_LIMITS,
          loginPerAccountIp: {
            free: 2,
            baseMs: 60_000,
            maxMs: 60_000,
            windowMs: 60_000,
          },
        },
      },
    );
    for (const slug of slugs) {
      await http()
        .post('/api/v1/auth/register')
        .send({
          tenantName: `Mağaza ${slug}`,
          tenantSlug: slug,
          name: 'Sahip',
          email: `${slug}@test.local`,
          password: PASSWORD,
        })
        .expect(201);
    }
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('wrong passwords count toward the same lockout as /auth/login', async () => {
    const ownerA = (
      await http()
        .post('/api/v1/auth/login')
        .send({ email: `${slugs[0]}@test.local`, password: PASSWORD })
        .expect(200)
    ).body.data.accessToken as string;
    const to = `${slugs[1]}@test.local`; // existing account (owner of B)
    await http()
      .post('/api/v1/invitations')
      .set({ Authorization: `Bearer ${ownerA}` })
      .send({ email: to, tenantRole: 'admin' })
      .expect(201);
    const token = mail.tokenFor(to);
    const accept = (password: string) =>
      http()
        .post('/api/v1/invitations/accept')
        .set('X-Forwarded-For', ip)
        .send({ token, password });

    await accept('Wrong-Password-1').expect(401);
    await accept('Wrong-Password-2').expect(401);
    // Locked: even the right password waits, on both endpoints.
    await accept(PASSWORD).expect(429);
    await http()
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: to, password: PASSWORD })
      .expect(429);
  });
});
