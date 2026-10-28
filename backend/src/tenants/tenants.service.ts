import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '../database/prisma.types.js';
import { TenantsRepository } from './tenants.repository.js';

/** Public API of the tenants module. Other modules never touch the tenants table directly. */
@Injectable()
export class TenantsService {
  constructor(private readonly repository: TenantsRepository) {}

  /** Must run inside TenantContext.runAsSystem: no tenant exists yet. */
  create(tx: PrismaTx, input: { name: string; slug: string }) {
    return this.repository.create(tx, input);
  }

  /** Runs in the tenant's own context; the extension pins the lookup to that id. */
  async isActive(tx: PrismaTx, id: string): Promise<boolean> {
    return (await this.repository.findActive(tx, id)) !== null;
  }
}
