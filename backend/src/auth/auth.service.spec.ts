import { UnauthorizedException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { TenantContext } from '../tenancy/tenant-context.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

const PASSWORD = 'Sifre-12345';
const USER = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

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
    revokeAllForUserEverywhere: vi.fn(),
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
    bumpAuthVersionForUser: vi.fn(),
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
  return { service, repository, memberships, tokens, audit, tx };
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
      expect(repository.revokeAllForUserEverywhere).not.toHaveBeenCalled();
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
    expect(repository.revokeAllForUserEverywhere).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('a missing user is refused like a disabled one', async () => {
    const { service, repository } = setup();
    repository.findRefreshToken.mockResolvedValue(stored());
    repository.findUserState.mockResolvedValue(null);
    expect(await rejection(service.refresh('presented'))).toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    expect(repository.revokeAllForUserEverywhere).not.toHaveBeenCalled();
  });

  describe('reuse', () => {
    /** Mocks that record the tenant context each call ran in. */
    function reuseSetup() {
      const ctx = setup();
      const seen: Record<string, { system: boolean; tenant?: string }[]> = {
        revoke: [],
        bump: [],
        audit: [],
      };
      const here = () => ({
        system: TenantContext.isSystem(),
        tenant: TenantContext.tenantId(),
      });
      ctx.repository.revokeAllForUserEverywhere.mockImplementation(
        async () => {
          seen.revoke.push(here());
          return [
            { tenantId: TENANT, count: 2 },
            { tenantId: OTHER, count: 1 },
          ];
        },
      );
      ctx.memberships.bumpAuthVersionForUser.mockImplementation(async () => {
        seen.bump.push(here());
        return [TENANT, OTHER];
      });
      ctx.audit.record.mockImplementation(async () => {
        seen.audit.push(here());
      });
      ctx.repository.findUserState.mockResolvedValue(ACTIVE);
      return { ...ctx, seen };
    }

    const reuseEvents = (audit: { record: ReturnType<typeof vi.fn> }) =>
      audit.record.mock.calls
        .map(([e]) => e as { action: string })
        .filter((e) => e.action === 'TOKEN_REUSE_DETECTED');

    it('revokes refresh tokens in every tenant and bumps every membership in one system-context transaction', async () => {
      const { service, repository, memberships, tokens, seen, tx } =
        reuseSetup();
      repository.findRefreshToken.mockResolvedValue(stored(new Date()));

      expect(await rejection(service.refresh('presented'))).toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
      expect(repository.revokeAllForUserEverywhere).toHaveBeenCalledWith(
        tx,
        USER,
      );
      expect(memberships.bumpAuthVersionForUser).toHaveBeenCalledWith(
        tx,
        USER,
      );
      expect(repository.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(seen.revoke).toEqual([{ system: true, tenant: undefined }]);
      expect(seen.bump).toEqual([{ system: true, tenant: undefined }]);
      expect(tokens.signAccess).not.toHaveBeenCalled();
    });

    it('writes one truthful audit row into each affected tenant', async () => {
      const { service, repository, audit, seen } = reuseSetup();
      repository.findRefreshToken.mockResolvedValue(stored(new Date()));
      await rejection(service.refresh('presented'));

      expect(seen.audit).toEqual([
        { system: false, tenant: TENANT },
        { system: false, tenant: OTHER },
      ]);
      const shared = {
        detectedInTenantId: TENANT,
        accessRevoked: true,
        totalRefreshRevokedCount: 3,
        affectedTenantIds: [TENANT, OTHER],
      };
      expect(reuseEvents(audit)).toEqual([
        expect.objectContaining({
          entityType: 'User',
          entityId: USER,
          actorUserId: null,
          after: { ...shared, refreshRevokedCount: 2 },
        }),
        expect.objectContaining({
          entityId: USER,
          actorUserId: null,
          after: { ...shared, refreshRevokedCount: 1 },
        }),
      ]);
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
        'presented',
      );
    });

    it('still audits the detecting tenant when nothing was left to revoke', async () => {
      const { service, repository, memberships, audit, seen } = reuseSetup();
      repository.revokeAllForUserEverywhere.mockResolvedValue([]);
      memberships.bumpAuthVersionForUser.mockResolvedValue([TENANT]);
      repository.findRefreshToken.mockResolvedValue(stored(new Date()));
      await rejection(service.refresh('presented'));

      expect(seen.audit).toEqual([{ system: false, tenant: TENANT }]);
      expect(reuseEvents(audit)).toEqual([
        expect.objectContaining({
          after: {
            detectedInTenantId: TENANT,
            refreshRevokedCount: 0,
            accessRevoked: true,
            totalRefreshRevokedCount: 0,
            affectedTenantIds: [TENANT],
          },
        }),
      ]);
    });

    it('treats a lost rotation race as reuse with the same revocation', async () => {
      const { service, repository, memberships, tokens, tx } = reuseSetup();
      repository.findRefreshToken.mockResolvedValue(stored());
      repository.revokeRefreshToken.mockResolvedValue(false);
      await rejection(service.refresh('presented'));
      expect(repository.revokeAllForUserEverywhere).toHaveBeenCalledWith(
        tx,
        USER,
      );
      expect(memberships.bumpAuthVersionForUser).toHaveBeenCalledWith(
        tx,
        USER,
      );
      expect(tokens.signAccess).not.toHaveBeenCalled();
    });

    it.each([['revoke'], ['bump']])(
      'fails the request and claims nothing when the %s fails',
      async (which) => {
        const { service, repository, memberships, tokens, audit } =
          reuseSetup();
        const boom = new Error('db down');
        if (which === 'revoke') {
          repository.revokeAllForUserEverywhere.mockRejectedValue(boom);
        } else {
          memberships.bumpAuthVersionForUser.mockRejectedValue(boom);
        }
        repository.findRefreshToken.mockResolvedValue(stored(new Date()));

        const error: unknown = await service
          .refresh('presented')
          .catch((e: unknown) => e);
        expect(error).toBe(boom);
        expect(reuseEvents(audit)).toEqual([]);
        expect(tokens.signAccess).not.toHaveBeenCalled();
        expect(repository.createRefreshToken).not.toHaveBeenCalled();
      },
    );

    it('a failed audit write after revocation still answers INVALID_REFRESH_TOKEN', async () => {
      const { service, repository, audit } = reuseSetup();
      audit.record.mockRejectedValue(new Error('audit down'));
      repository.findRefreshToken.mockResolvedValue(stored(new Date()));
      expect(await rejection(service.refresh('presented'))).toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
      expect(repository.revokeAllForUserEverywhere).toHaveBeenCalledTimes(1);
    });
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
    expect(repository.revokeAllForUserEverywhere).not.toHaveBeenCalled();
  });
});
