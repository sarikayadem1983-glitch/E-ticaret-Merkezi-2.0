import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  MAIL_TRANSPORT,
  type MailTransport,
  type OutgoingMail,
} from './../src/mail/mail.transport.js';
import { createTestApp, ownerPool, purgeTenants } from './helpers.js';

const PASSWORD = 'Correct-Horse-9';
const NEW_PASSWORD = 'Battery-Staple-7';

class FakeTransport implements MailTransport {
  sent: OutgoingMail[] = [];
  send(mail: OutgoingMail): Promise<void> {
    this.sent.push(mail);
    return Promise.resolve();
  }
  count(to: string) {
    return this.sent.filter((m) => m.to === to).length;
  }
  async tokenFor(to: string, path: string): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const mail = this.sent.filter((m) => m.to === to).at(-1);
      const token = mail?.text.match(
        new RegExp(`/${path}/([A-Za-z0-9_-]+)`),
      )?.[1];
      if (token) return token;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no ${path} mail for ${to}`);
  }
}

const sql = async <T>(text: string, params: unknown[]) => {
  const pool = ownerPool();
  try {
    return (await pool.query(text, params)).rows as T[];
  } finally {
    await pool.end();
  }
};

describe('Password reset and e-mail verification (e2e, USR-19)', () => {
  let app: INestApplication<App>;
  const mail = new FakeTransport();
  const run = randomUUID().slice(0, 8);
  const slug = `rec-${run}`;
  const email = `${slug}@test.local`;
  let refresh: string;
  let access: string;

  const http = () => request(app.getHttpServer());
  const forgot = (e: string) =>
    http().post('/api/v1/auth/password/forgot').send({ email: e });
  const reset = (token: string, password = NEW_PASSWORD) =>
    http().post('/api/v1/auth/password/reset').send({ token, password });
  const login = (password: string) =>
    http().post('/api/v1/auth/login').send({ email, password });

  beforeAll(async () => {
    app = await createTestApp(
      { APP_ORIGIN: 'http://localhost:3000' },
      { providers: [{ provide: MAIL_TRANSPORT, useValue: mail }] },
    );
    const res = await http()
      .post('/api/v1/auth/register')
      .send({
        tenantName: `Mağaza ${slug}`,
        tenantSlug: slug,
        name: 'Sahip',
        email,
        password: PASSWORD,
      })
      .expect(201);
    refresh = res.body.data.refreshToken;
    access = res.body.data.accessToken;
  });

  afterAll(async () => {
    await app?.close();
    const pool = ownerPool();
    try {
      await pool.query(
        'DELETE FROM user_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
        [email],
      );
    } finally {
      await pool.end();
    }
    await purgeTenants([slug]);
  });

  it('answers the same for known and unknown addresses; mails only the known one', async () => {
    const known = await forgot(email).expect(202);
    const unknown = await forgot(`nobody-${run}@test.local`).expect(202);
    expect(known.body).toEqual(unknown.body);
    await mail.tokenFor(email, 'reset-password');
    expect(mail.count(`nobody-${run}@test.local`)).toBe(0);
  });

  it('stores only the hash of the token', async () => {
    const token = await mail.tokenFor(email, 'reset-password');
    const rows = await sql<{ token_hash: string }>(
      `SELECT t.token_hash FROM user_tokens t JOIN users u ON u.id = t.user_id WHERE u.email = $1`,
      [email],
    );
    const hash = createHash('sha256').update(token).digest('hex');
    expect(rows.map((r) => r.token_hash)).toContain(hash);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('a newer request invalidates the older link', async () => {
    const first = await mail.tokenFor(email, 'reset-password');
    const before = mail.count(email);
    await forgot(email).expect(202);
    for (let i = 0; i < 50 && mail.count(email) === before; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const second = await mail.tokenFor(email, 'reset-password');
    expect(second).not.toBe(first);
    await reset(first).expect(400);
  });

  it('rejects unknown, short and weak inputs', async () => {
    await reset('x'.repeat(43)).expect(400);
    await reset('short').expect(422);
    await reset(await mail.tokenFor(email, 'reset-password'), '123').expect(
      422,
    );
  });

  it('resets the password, ends every session and is single-use', async () => {
    const token = await mail.tokenFor(email, 'reset-password');
    await reset(token).expect(204);
    await reset(token).expect(400);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refresh })
      .expect(401);
    await http()
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${access}` })
      .expect(401);
    await login(PASSWORD).expect(401);
    const ok = await login(NEW_PASSWORD).expect(200);
    access = ok.body.data.accessToken;
    const [user] = await sql<{ email_verified_at: Date | null }>(
      'SELECT email_verified_at FROM users WHERE email = $1',
      [email],
    );
    expect(user.email_verified_at).not.toBeNull();
  });

  it('an expired token is refused', async () => {
    await forgot(email).expect(202);
    const before = mail.count(email);
    void before;
    const token = await mail.tokenFor(email, 'reset-password');
    await sql(
      `UPDATE user_tokens SET expires_at = created_at + interval '1 second', created_at = created_at - interval '1 hour'
       WHERE token_hash = $1`,
      [createHash('sha256').update(token).digest('hex')],
    );
    await reset(token).expect(400);
  });

  it('verifies the e-mail with a single-use link', async () => {
    await sql('UPDATE users SET email_verified_at = NULL WHERE email = $1', [
      email,
    ]);
    await http()
      .post('/api/v1/auth/email/verification')
      .set({ Authorization: `Bearer ${access}` })
      .expect(202);
    const token = await mail.tokenFor(email, 'verify-email');
    await http()
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(400);
    await http().post('/api/v1/auth/email/verify').send({ token }).expect(204);
    await http().post('/api/v1/auth/email/verify').send({ token }).expect(400);
    const [user] = await sql<{ email_verified_at: Date | null }>(
      'SELECT email_verified_at FROM users WHERE email = $1',
      [email],
    );
    expect(user.email_verified_at).not.toBeNull();
  });
});
