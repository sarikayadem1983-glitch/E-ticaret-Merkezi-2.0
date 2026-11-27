import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { VariantCostsService } from './variant-costs.service.js';

const user = { sub: 'user', tid: 'tenant', perms: ['products:write'], ver: 1 };
const stamp = new Date('2026-11-26T12:00:00Z');
const cost = (amount: string | null) => ({
  id: 'variant',
  purchaseCost: amount === null ? null : new Prisma.Decimal(amount),
  costCurrency: amount === null ? null : 'TRY',
  purchaseCostUpdatedAt: amount === null ? null : stamp,
});

describe('variant purchase costs (RPT-02 prerequisite)', () => {
  function setup(amount: string | null = null) {
    const tx = {
      productVariant: {
        findFirst: vi.fn().mockResolvedValue(cost(amount)),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...cost(data.purchaseCost),
            purchaseCostUpdatedAt: data.purchaseCostUpdatedAt,
          }),
        ),
      },
    };
    const prisma = {
      ...tx,
      $transaction: vi.fn().mockImplementation((fn) => fn(tx)),
    };
    const repo = { prisma };
    const products = {
      get: vi
        .fn()
        .mockResolvedValue({ data: { id: 'product', companyId: 'company' } }),
      accessible: vi
        .fn()
        .mockResolvedValue({ id: 'product', companyId: 'company' }),
    };
    const access = {
      assertCompanyPermission: vi.fn().mockResolvedValue(undefined),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const args = [
      repo,
      products,
      access,
      audit,
    ] as unknown as ConstructorParameters<typeof VariantCostsService>;
    return {
      service: new VariantCostsService(...args),
      tx,
      prisma,
      products,
      access,
      audit,
    };
  }

  it('keeps missing cost distinct from zero', async () => {
    const { service } = setup();
    await expect(service.get(user, 'product', 'variant')).resolves.toEqual({
      data: null,
    });
    await expect(
      setup('0').service.get(user, 'product', 'variant'),
    ).resolves.toEqual({
      data: { amount: '0.00', currency: 'TRY', updatedAt: stamp },
    });
  });

  it('checks fresh company write permission before reading cost', async () => {
    const { service, access, tx } = setup('12.5');
    access.assertCompanyPermission.mockRejectedValue(new ForbiddenException());
    await expect(
      service.get(user, 'product', 'variant'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.productVariant.findFirst).not.toHaveBeenCalled();
  });

  it('binds lookup to the parent product and company', async () => {
    const { service, tx, access } = setup('12.5');
    await expect(
      service.get(user, 'product', 'variant'),
    ).resolves.toMatchObject({ data: { amount: '12.50' } });
    expect(access.assertCompanyPermission).toHaveBeenCalledWith(
      user,
      'company',
      'products:write',
    );
    expect(tx.productVariant.findFirst.mock.calls[0][0].where).toEqual({
      id: 'variant',
      productId: 'product',
      companyId: 'company',
      deletedAt: null,
    });
  });

  it('returns 404 for an absent or mismatched variant', async () => {
    const { service, tx } = setup();
    tx.productVariant.findFirst.mockResolvedValue(null);
    await expect(service.get(user, 'product', 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('writes exact cost and private-value-free audit in one serializable transaction', async () => {
    const { service, tx, prisma, products, audit } = setup('1.10');
    const result = await service.set(user, 'product', 'variant', {
      amount: '12.50',
      currency: 'TRY',
    });
    expect(result.data?.amount).toBe('12.50');
    expect(products.accessible).toHaveBeenCalledWith(user, 'product', true, tx);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(tx.productVariant.update.mock.calls[0][0].data).toMatchObject({
      purchaseCost: '12.50',
      costCurrency: 'TRY',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'VariantPurchaseCost',
        before: { hasCost: true },
        after: { hasCost: true, changedFields: ['amount'] },
      }),
      tx,
    );
  });

  it('never starts a cost write if the product is inactive or forbidden', async () => {
    const { service, products, tx, audit } = setup();
    products.accessible.mockRejectedValue(new ForbiddenException());
    await expect(
      service.set(user, 'product', 'variant', { amount: '1', currency: 'TRY' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.productVariant.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('propagates audit failure out of the transaction', async () => {
    const { service, audit } = setup();
    audit.record.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      service.set(user, 'product', 'variant', { amount: '1', currency: 'TRY' }),
    ).rejects.toThrow('audit unavailable');
  });

  it('does not disclose purchase amounts or currency through general audit payloads', async () => {
    const { service, audit } = setup('1.10');
    await service.set(user, 'product', 'variant', {
      amount: '12.50',
      currency: 'TRY',
    });
    const event = audit.record.mock.calls[0][0];
    expect(JSON.stringify(event)).not.toContain('12.50');
    expect(JSON.stringify(event)).not.toContain('1.10');
    expect(JSON.stringify(event)).not.toContain('TRY');
  });

  it('does not write when the variant belongs to a different product', async () => {
    const { service, tx } = setup();
    tx.productVariant.findFirst.mockResolvedValue(null);
    await expect(
      service.set(user, 'product', 'other', { amount: '1', currency: 'TRY' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.productVariant.update).not.toHaveBeenCalled();
  });
});
