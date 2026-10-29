import { UnauthorizedException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

const PASSWORD = 'Sifre-12345';
const USER = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';

type State = { isActive: boolean; deletedAt: Date | null };
const ACTIVE: State = { isActive: true, deletedAt: null };
const INACTIVE: State = { isActive: false, deletedAt: null };
const DELETED: State = { isActive: true, deletedAt: new Date() };

let passwordHash = '';
beforeAll(async () => {
  passwordHash = await hash(PASSWORD);
});

function setup() {
  const tx = {};
  const repository = {
    prisma: {
      $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    },
    findUserForLogin: vi.fn(),
    findUserState: vi.fn(),
    findRefreshToken: vi.fn(),
    revokeRefreshToken: vi.fn().mockResolvedValue(true),
    revokeAllForUser: vi.fn(),
    createRefreshToken: vi.fn().mockResolvedValue({ id: 'new-rt' }),
    findPermissions: vi.fn().mockResolvedValue(['companies:read']),
    touchLastLogin: vi.fn(),
  };
  const memberships = {
    findAllForUser: vi.fn().mockResolvedValue([
      {
        tenantId: TENANT,
        tenantName: 'M',
        tenantSlug: 'm',
        active: true,
        tenantActive: true,
        changedAt: new Date(),
      },
    ]),
    get: vi.fn().mockResolvedValue({ status: 'active', authVersion: 3 }),
  };
  const tenants = { isActive: vi.fn().mockResolvedValue(true) };
  const tokens = {
    newRefreshToken: vi.fn(() => ({
      token: 'refresh-new',
      hash: 'h',
      expiresAt: new Date(Date.now() + 60_000),
    })),
    signAccess: vi
      .fn()
      .mockResolvedValue({ token: 'access-new', expiresIn: 900 }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new AuthService(
    repository as never,
    tenants as never,
    tokens as never,
    audit as never,
    memberships as never,
  );
  return { service, repository, memberships, tokens, audit };
}

const loginUser = (state: State) => ({
  id: USER,
  passwordHash,
  lastTenantId: TENANT,
  ...state,
});

async function rejection(p: Promise<unknown>) {
  const error = await p.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(UnauthorizedException);
  return (error as UnauthorizedException).getResponse();
}

const failedReasons = (audit: { record: ReturnType<typeof vi.fn> }) =>
  audit.record.mock.calls
    .map(([e]) => e as { action: string; after?: { reason?: string } })
    .filter((e) => e.action === 'LOGIN_FAILED')
    .map((e) => e.after?.reason);

describe('AuthService.login', () => {
  it.each([
    ['inactive', INACTIVE, PASSWORD, 'user_inactive'],
    ['deleted', DELETED, PASSWORD, 'user_deleted'],
    ['inactive (wrong password)', INACTIVE, 'Yanlis-1', 'invalid_password'],
    ['deleted (wrong password)', DELETED, 'Yanlis-1', 'invalid_password'],
  ])(
    'refuses a %s user with INVALID_CREDENTIALS and audits the reason',
    async (_n, state, password, reason) => {
      const { service, repository, tokens, audit } = setup();
      repository.findUserForLogin.mockResolvedValue(loginUser(state));

      expect(
        await rejection(service.login({ email: 'a@x.com', password })),
      ).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Email veya şifre hatalı',
      });
      await vi.waitFor(() => expect(failedReasons(audit)).toEqual([reason]));
      expect(tokens.signAccess).not.toHaveBeenCalled();
      expect(repository.createRefreshToken).not.toHaveBeenCalled();
      const event = audit.record.mock.calls[0][0];
      expect(JSON.stringify(event)).not.toContain(password);
      expect(JSON.stringify(event)).not.toContain(passwordHash);
    },
  );

  it('the same body as a wrong password for an active user', async () => {
    const { service, repository, audit } = setup();
    repository.findUserForLogin.mockResolvedValue(loginUser(ACTIVE));
    const wrong = await rejection(
      service.login({ email: 'a@x.com', password: 'Yanlis-1' }),
    );
    repository.findUserForLogin.mockResolvedValue(loginUser(INACTIVE));
    const disabled = await rejection(
      service.login({ email: 'a@x.com', password: PASSWORD }),
    );
    expect(disabled).toEqual(wrong);
    await vi.waitFor(() =>
      expect(failedReasons(audit)).toEqual([
        'invalid_password',
        'user_inactive',
      ]),
    );
  });

  it('records a wrong password of an active user in the background', async () => {
    const { service, repository, audit } = setup();
    repository.findUserForLogin.mockResolvedValue(loginUser(ACTIVE));
    let release!: () => void;
    audit.record.mockReturnValue(new Promise<void>((r) => (release = r)));

    // Rejects although the audit write has not finished.
    await rejection(service.login({ email: 'a@x.com', password: 'Yanlis-1' }));
    expect(failedReasons(audit)).toEqual(['invalid_password']);
    release();
  });

  it('logs an active user in', async () => {
    const { service, repository, tokens } = setup();
    repository.findUserForLogin.mockResolvedValue(loginUser(ACTIVE));
    const pair = await service.login({ email: 'a@x.com', password: PASSWORD });
    expect(pair).toEqual({
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      expiresIn: 900,
    });
    expect(tokens.signAccess).toHaveBeenCalledWith({
      sub: USER,
      tid: TENANT,
      perms: ['companies:read'],
      ver: 3,
    });
  });
});

describe('AuthService.refresh', () => {
  const stored = (revokedAt: Date | null = null) => ({
    id: 'rt-1',
    tenantId: TENANT,
    userId: USER,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt,
  });

  it.each([
    ['inactive', INACTIVE],
    ['deleted', DELETED],
  ])(
    'revokes the token of a %s user and returns INVALID_REFRESH_TOKEN',
    async (_n, state) => {
      const { service, repository, tokens, audit } = setup();
      repository.findRefreshToken.mockResolvedValue(stored());
      repository.findUserState.mockResolvedValue(state);

      expect(await rejection(service.refresh('presented'))).toEqual({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Oturum geçersiz, tekrar giriş yapın',
      });
      expect(repository.findRefreshToken).toHaveBeenCalledWith(
        TokenService.hash('presented'),
      );
      expect(repository.revokeRefreshToken).toHaveBeenCalledTimes(1);
      expect(repository.revokeRefreshToken).toHaveBeenCalledWith(
        repository.prisma,
        'rt-1',
        null,
      );
      expect(repository.revokeAllForUser).not.toHaveBeenCalled();
      expect(repository.createRefreshToken).not.toHaveBeenCalled();
      expect(tokens.signAccess).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('skips the revoke for an already revoked token of a disabled user (no reuse alarm)', async () => {
    const { service, repository, audit } = setup();
    repository.findRefreshToken.mockResolvedValue(stored(new Date()));
    repository.findUserState.mockResolvedValue(INACTIVE);

    expect(await rejection(service.refresh('presented'))).toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    expect(repository.revokeRefreshToken).not.toHaveBeenCalled();
    expect(repository.revokeAllForUser).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('a missing user is refused like a disabled one', async () => {
    const { service, repository } = setup();
    repository.findRefreshToken.mockResolvedValue(stored());
    repository.findUserState.mockResolvedValue(null);
    expect(await rejection(service.refresh('presented'))).toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    expect(repository.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('still treats a revoked token of an active user as reuse', async () => {
    const { service, repository } = setup();
    repository.findRefreshToken.mockResolvedValue(stored(new Date()));
    repository.findUserState.mockResolvedValue(ACTIVE);
    await rejection(service.refresh('presented'));
    expect(repository.revokeAllForUser).toHaveBeenCalledWith(USER);
  });

  it('rotates the token of an active user', async () => {
    const { service, repository } = setup();
    repository.findRefreshToken.mockResolvedValue(stored());
    repository.findUserState.mockResolvedValue(ACTIVE);
    const pair = await service.refresh('presented');
    expect(pair).toEqual({
      accessToken: 'access-new',
      refreshToken: 'refresh-new',
      expiresIn: 900,
    });
    expect(repository.revokeRefreshToken).toHaveBeenCalledWith(
      {},
      'rt-1',
      'new-rt',
    );
    expect(repository.revokeAllForUser).not.toHaveBeenCalled();
  });
});
