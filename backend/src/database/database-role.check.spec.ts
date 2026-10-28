import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DatabaseRoleCheck } from './database-role.check.js';
import type { TenantPrismaClient } from './prisma.service.js';

const SAFE = {
  role: 'tm_app',
  superuser: false,
  bypassrls: false,
  owns_tables: false,
};

function checkWith(row: typeof SAFE, nodeEnv: string) {
  const prisma = { $queryRaw: vi.fn().mockResolvedValue([row]) };
  const config = { get: vi.fn().mockReturnValue(nodeEnv) };
  return new DatabaseRoleCheck(
    prisma as unknown as TenantPrismaClient,
    config as unknown as ConfigService,
  );
}

describe('DatabaseRoleCheck', () => {
  const warn = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);

  beforeEach(() => warn.mockClear());

  it('accepts the least-privileged role silently', async () => {
    await expect(
      checkWith(SAFE, 'production').onApplicationBootstrap(),
    ).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...SAFE, role: 'postgres', superuser: true }, /superuser/],
    [{ ...SAFE, bypassrls: true }, /BYPASSRLS/],
    [{ ...SAFE, role: 'tm_migrator', owns_tables: true }, /tablo sahibi/],
  ])('refuses to start in production with %o', async (row, reason) => {
    await expect(
      checkWith(row, 'production').onApplicationBootstrap(),
    ).rejects.toThrow(reason);
  });

  it('only warns outside production', async () => {
    await checkWith(
      { ...SAFE, superuser: true },
      'development',
    ).onApplicationBootstrap();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/superuser/));
  });
});
