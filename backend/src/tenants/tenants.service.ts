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

  /** Must run inside TenantContext.runAsSystem: slugs are global. */
  async takenSlugs(tx: PrismaTx, candidates: string[]): Promise<Set<string>> {
    const rows = await this.repository.findSlugs(tx, candidates);
    return new Set(rows.map((r) => r.slug));
  }

  /** Runs in the tenant's own context; the extension pins the lookup to that id. */
  async isActive(tx: PrismaTx, id: string): Promise<boolean> {
    return (await this.repository.findActive(tx, id)) !== null;
  }

  /** Name and slug for display, e.g. the signed-in user's profile. */
  profile(tx: PrismaTx, id: string) {
    return this.repository.findProfile(tx, id);
  }
}
