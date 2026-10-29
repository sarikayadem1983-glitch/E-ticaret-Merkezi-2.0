import { loadMailConfig, MailConfigError } from './mail.config.js';

const prodSmtp = {
  NODE_ENV: 'production',
  MAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  MAIL_FROM: 'Ticaret Merkezi <no-reply@example.com>',
};

describe('loadMailConfig', () => {
  it('defaults to the log transport outside production', () => {
    expect(loadMailConfig({}).transport).toBe('log');
  });

  it('rejects MAIL_TRANSPORT=log in production', () => {
    expect(() =>
      loadMailConfig({ NODE_ENV: 'production', MAIL_TRANSPORT: 'log' }),
    ).toThrow(MailConfigError);
  });

  it('defaults to smtp in production', () => {
    expect(() =>
      loadMailConfig({ NODE_ENV: 'production', MAIL_FROM: 'a@b.co' }),
    ).toThrow(/SMTP_HOST/);
  });

  it('rejects an unknown transport', () => {
    expect(() => loadMailConfig({ MAIL_TRANSPORT: 'sendmail' })).toThrow(
      MailConfigError,
    );
  });

  it('requires TLS in production', () => {
    const config = loadMailConfig(prodSmtp);
    expect(config.smtp).toMatchObject({ secure: false, requireTls: true });
    expect(() =>
      loadMailConfig({ ...prodSmtp, SMTP_REQUIRE_TLS: 'false' }),
    ).toThrow(MailConfigError);
  });

  it('accepts implicit TLS (SMTP_SECURE=true) in production', () => {
    const config = loadMailConfig({
      ...prodSmtp,
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
    });
    expect(config.smtp).toMatchObject({ port: 465, secure: true });
  });

  it('requires MAIL_FROM in production', () => {
    const env: Record<string, string> = { ...prodSmtp };
    delete env.MAIL_FROM;
    expect(() => loadMailConfig(env)).toThrow(/MAIL_FROM/);
  });

  it('allows plain SMTP for Mailpit in development', () => {
    const config = loadMailConfig({
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
    });
    expect(config.smtp).toMatchObject({
      host: '127.0.0.1',
      port: 1025,
      secure: false,
      requireTls: false,
      auth: undefined,
      timeoutMs: 10_000,
    });
  });

  it('needs SMTP_USER and SMTP_PASSWORD together', () => {
    expect(() =>
      loadMailConfig({
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'h',
        SMTP_USER: 'u',
      }),
    ).toThrow(/SMTP_PASSWORD/);
  });

  it.each(['0', '70000', 'abc'])('rejects SMTP_PORT=%s', (port) => {
    expect(() =>
      loadMailConfig({
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'h',
        SMTP_PORT: port,
      }),
    ).toThrow(MailConfigError);
  });

  it('rejects a MAIL_FROM without an address', () => {
    expect(() => loadMailConfig({ MAIL_FROM: 'Ticaret Merkezi' })).toThrow(
      MailConfigError,
    );
  });

  it('never echoes SMTP_PASSWORD in an error', () => {
    try {
      loadMailConfig({
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'h',
        SMTP_PORT: 'x',
        SMTP_PASSWORD: 'hunter2-secret',
      });
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2-secret');
    }
  });
});
