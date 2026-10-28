import type { TenantPrismaClient } from './../src/database/prisma.service.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';

/**
 * Removes test tenants and everything they own. audit_logs is append-only, so
 * its rows are removed with raw SQL under the purge flag the DB trigger allows.
 */
export async function purgeTenants(
  prisma: TenantPrismaClient,
  slugs: string[],
): Promise<void> {
  await TenantContext.runAsSystem(() =>
    prisma.$transaction(async (tx) => {
      const ids = (
        await tx.tenant.findMany({
          where: { slug: { in: slugs } },
          select: { id: true },
        })
      ).map((t) => t.id);
      if (ids.length === 0) return;
      await tx.$queryRaw`SELECT set_config('app.allow_audit_purge', 'on', true)`;
      await tx.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ANY(${ids}::uuid[])`;
      await tx.user.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.role.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
    }),
  );
}
