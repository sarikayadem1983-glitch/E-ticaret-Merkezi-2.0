import { ConflictException } from '@nestjs/common';
import type { TenantPrismaClient } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { CATALOG_WRITE_ATTEMPTS, catalogWrite } from './catalog.tx.js';

const serialization = () =>
  new Prisma.PrismaClientKnownRequestError('could not serialize access', {
    code: 'P2034',
    clientVersion: 'test',
  });

/** A fake client whose $transaction fails `failures` times, then runs fn. */
function fake(failures: number, error: () => Error = serialization) {
  let calls = 0;
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      calls++;
      if (calls <= failures) throw error();
      return fn({});
    },
  } as unknown as TenantPrismaClient;
  return { prisma, calls: () => calls };
}

const noSleep = async () => {};

describe('catalogWrite (R-26)', () => {
  it('retries serialization failures and then succeeds', async () => {
    const f = fake(CATALOG_WRITE_ATTEMPTS - 1);
    await expect(
      catalogWrite(f.prisma, async () => 'ok', noSleep),
    ).resolves.toBe('ok');
    expect(f.calls()).toBe(CATALOG_WRITE_ATTEMPTS);
  });

  it('answers 409 CONCURRENT_UPDATE after the last attempt', async () => {
    const f = fake(CATALOG_WRITE_ATTEMPTS);
    const err = await catalogWrite(f.prisma, async () => 'ok', noSleep).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'CONCURRENT_UPDATE',
    });
    expect(f.calls()).toBe(CATALOG_WRITE_ATTEMPTS);
  });

  it('never retries other errors (e.g. a taken SKU)', async () => {
    const f = fake(1, () => new Error('boom'));
    await expect(
      catalogWrite(f.prisma, async () => 'ok', noSleep),
    ).rejects.toThrow('boom');
    expect(f.calls()).toBe(1);
  });
});
