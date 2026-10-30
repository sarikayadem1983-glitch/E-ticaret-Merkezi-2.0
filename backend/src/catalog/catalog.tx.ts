import { ForbiddenException } from '@nestjs/common';
import type { AccessService } from '../access/access.service.js';
import type { AuthUser } from '../auth/decorators.js';
import type { TenantPrismaClient } from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { mapCatalogError } from './catalog.errors.js';

export const MODULE = 'catalog';

/**
 * Catalog writes run SERIALIZABLE: checks that read other rows (cycle walk,
 * "category not deleted", "category not in use", "not the last variant") and
 * the write that depends on them cannot interleave with a conflicting write
 * (Postgres aborts one; it answers 409 CONCURRENT_UPDATE). Database errors
 * are mapped to stable API errors.
 */
export async function catalogWrite<T>(
  prisma: TenantPrismaClient,
  fn: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(fn, { isolationLevel: 'Serializable' });
  } catch (error) {
    mapCatalogError(error);
  }
}

/**
 * Categories and brands are shared by every company, so only a tenant role
 * that writes products in every company (Owner, Admin) changes them. Read from
 * the database, not from the JWT `perms`.
 */
export async function assertTenantCatalogWriter(
  access: AccessService,
  user: AuthUser,
): Promise<void> {
  if ((await access.companyScope(user, 'products:write')) !== null) {
    throw new ForbiddenException('Yetki yok');
  }
}
