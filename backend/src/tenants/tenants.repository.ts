import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '../database/prisma.types.js';

@Injectable()
export class TenantsRepository {
  create(tx: PrismaTx, data: { name: string; slug: string }) {
    return tx.tenant.create({ data, select: { id: true } });
  }

  findActive(tx: PrismaTx, id: string) {
    return tx.tenant.findFirst({
      where: { id, isActive: true, deletedAt: null },
      select: { id: true },
    });
  }

  findProfile(tx: PrismaTx, id: string) {
    return tx.tenant.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, slug: true },
    });
  }
}
