import type { TenantPrismaClient } from './prisma.service.js';

/** Client handed to interactive transaction callbacks. Still tenant-scoped. */
export type PrismaTx = Omit<
  TenantPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
