import { Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import type { BrandDto, ListCatalogQuery } from './catalog.dto.js';
import { conflict, notFound } from './catalog.errors.js';
import { CatalogRepository } from './catalog.repository.js';
import {
  assertTenantCatalogWriter,
  catalogWrite,
  MODULE,
} from './catalog.tx.js';

const ENTITY = 'Brand';
const missing = () => notFound('Marka bulunamadı');

/** Tenant-wide brand list. */
@Injectable()
export class BrandsService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async list(q: ListCatalogQuery) {
    const { items, total } = await this.repository.findBrandPage(
      q.search || undefined,
      q.page,
      q.per_page,
    );
    return { data: items, meta: { page: q.page, per_page: q.per_page, total } };
  }

  async get(id: string) {
    const brand = await this.repository.findBrand(id);
    if (!brand) throw missing();
    return { data: brand };
  }

  async create(user: AuthUser, dto: BrandDto) {
    await assertTenantCatalogWriter(this.access, user);
    const brand = await catalogWrite(this.repository.prisma, async (tx) => {
      const created = await this.repository.createBrand(tx, dto.name);
      await this.audit.record(
        {
          action: 'CREATE',
          module: MODULE,
          entityType: ENTITY,
          entityId: created.id,
          after: created,
        },
        tx,
      );
      return created;
    });
    return { data: brand };
  }

  async update(user: AuthUser, id: string, dto: BrandDto) {
    await assertTenantCatalogWriter(this.access, user);
    const brand = await catalogWrite(this.repository.prisma, async (tx) => {
      const before = await this.repository.findBrand(id, tx);
      if (!before) throw missing();
      const after = await this.repository.updateBrand(tx, id, {
        name: dto.name,
      });
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: ENTITY,
          entityId: id,
          before,
          after,
        },
        tx,
      );
      return after;
    });
    return { data: brand };
  }

  /** Soft delete. Refused while active products use it. */
  async remove(user: AuthUser, id: string): Promise<void> {
    await assertTenantCatalogWriter(this.access, user);
    await catalogWrite(this.repository.prisma, async (tx) => {
      const before = await this.repository.findBrand(id, tx);
      if (!before) throw missing();
      if ((await this.repository.countBrandUsage(tx, id)) > 0) {
        throw conflict(
          'BRAND_IN_USE',
          'Markaya bağlı ürün var; önce ürünleri taşıyın',
        );
      }
      await this.repository.updateBrand(tx, id, { deletedAt: new Date() });
      await this.audit.record(
        {
          action: 'DELETE',
          module: MODULE,
          entityType: ENTITY,
          entityId: id,
          before,
        },
        tx,
      );
    });
  }
}
