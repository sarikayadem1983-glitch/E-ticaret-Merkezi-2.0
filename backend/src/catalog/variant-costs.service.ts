import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import type { PrismaTx } from '../database/prisma.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { SetPriceDto } from './catalog.dto.js';
import { CatalogRepository } from './catalog.repository.js';
import { catalogWrite } from './catalog.tx.js';
import { money } from './pricing.js';
import { ProductsService } from './products.service.js';

const FIELDS = {
  id: true,
  purchaseCost: true,
  costCurrency: true,
  purchaseCostUpdatedAt: true,
} satisfies Prisma.ProductVariantSelect;
type CostRow = Prisma.ProductVariantGetPayload<{ select: typeof FIELDS }>;
const present = (row: CostRow) =>
  row.purchaseCost === null
    ? null
    : {
        amount: money(row.purchaseCost),
        currency: row.costCurrency,
        updatedAt: row.purchaseCostUpdatedAt,
      };

/** Private current purchase-cost snapshots. General catalog queries never select these fields. */
@Injectable()
export class VariantCostsService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly products: ProductsService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private async find(
    db: PrismaTx,
    productId: string,
    companyId: string,
    variantId: string,
  ) {
    const row = await db.productVariant.findFirst({
      where: { id: variantId, productId, companyId, deletedAt: null },
      select: FIELDS,
    });
    if (!row)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Varyant bulunamadı',
      });
    return row;
  }

  async get(user: AuthUser, productId: string, variantId: string) {
    const { data: product } = await this.products.get(user, productId);
    await this.access.assertCompanyPermission(
      user,
      product.companyId,
      'products:write',
    );
    const row = await this.find(
      this.repository.prisma,
      productId,
      product.companyId,
      variantId,
    );
    return { data: present(row) };
  }

  async set(
    user: AuthUser,
    productId: string,
    variantId: string,
    dto: SetPriceDto,
  ) {
    const data = await catalogWrite(this.repository.prisma, async (tx) => {
      const product = await this.products.accessible(user, productId, true, tx);
      const before = await this.find(
        tx,
        productId,
        product.companyId,
        variantId,
      );
      const after = await tx.productVariant.update({
        where: { id: variantId },
        data: {
          purchaseCost: dto.amount,
          costCurrency: dto.currency,
          purchaseCostUpdatedAt: new Date(),
        },
        select: FIELDS,
      });
      await this.audit.record(
        {
          action: before.purchaseCost === null ? 'CREATE' : 'UPDATE',
          module: 'catalog',
          entityType: 'VariantPurchaseCost',
          entityId: variantId,
          // General audit readers need not have cost access in this company.
          // Record the operation and changed field names, never private values.
          before: { hasCost: before.purchaseCost !== null },
          after: {
            hasCost: true,
            changedFields: [
              ...(before.purchaseCost === null ||
              money(before.purchaseCost) !== money(dto.amount)
                ? ['amount']
                : []),
              ...(before.costCurrency !== dto.currency ? ['currency'] : []),
            ],
          },
        },
        tx,
      );
      return present(after);
    });
    return { data };
  }
}
