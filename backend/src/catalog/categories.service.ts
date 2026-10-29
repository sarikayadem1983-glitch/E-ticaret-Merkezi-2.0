import { Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import type { PrismaTx } from '../database/prisma.types.js';
import type {
  CreateCategoryDto,
  ListCatalogQuery,
  UpdateCategoryDto,
} from './catalog.dto.js';
import { conflict, notFound, unavailable } from './catalog.errors.js';
import { CatalogRepository } from './catalog.repository.js';
import {
  assertTenantCatalogWriter,
  catalogWrite,
  MODULE,
} from './catalog.tx.js';
import { createsCycle } from './category-tree.js';

const ENTITY = 'Category';
const missing = () => notFound('Kategori bulunamadı');

/** Tenant-wide category tree. */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async list(q: ListCatalogQuery) {
    const { items, total } = await this.repository.findCategoryPage(
      q.search || undefined,
      q.page,
      q.per_page,
    );
    return { data: items, meta: { page: q.page, per_page: q.per_page, total } };
  }

  async get(id: string) {
    const category = await this.repository.findCategory(id);
    if (!category) throw missing();
    return { data: category };
  }

  /** A parent must exist and not be soft-deleted. */
  private async assertParent(tx: PrismaTx, parentId: string) {
    if (!(await this.repository.findCategory(parentId, tx))) {
      throw unavailable(
        'CATEGORY_UNAVAILABLE',
        'Üst kategori bulunamadı veya silinmiş',
      );
    }
  }

  async create(user: AuthUser, dto: CreateCategoryDto) {
    await assertTenantCatalogWriter(this.access, user);
    const category = await catalogWrite(this.repository.prisma, async (tx) => {
      if (dto.parentId) await this.assertParent(tx, dto.parentId);
      const created = await this.repository.createCategory(tx, {
        name: dto.name,
        slug: dto.slug,
        parentId: dto.parentId ?? null,
      });
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
    return { data: category };
  }

  async update(user: AuthUser, id: string, dto: UpdateCategoryDto) {
    await assertTenantCatalogWriter(this.access, user);
    const category = await catalogWrite(this.repository.prisma, async (tx) => {
      const before = await this.repository.findCategory(id, tx);
      if (!before) throw missing();
      if (dto.parentId !== undefined && dto.parentId !== before.parentId) {
        if (
          await createsCycle(id, dto.parentId, (c) =>
            this.repository.findCategoryParent(tx, c),
          )
        ) {
          throw unavailable(
            'CATEGORY_CYCLE',
            'Kategori kendisinin veya alt kategorisinin altına taşınamaz',
          );
        }
        if (dto.parentId) await this.assertParent(tx, dto.parentId);
      }
      const after = await this.repository.updateCategory(tx, id, dto);
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
    return { data: category };
  }

  /** Soft delete. Refused while active subcategories or products use it. */
  async remove(user: AuthUser, id: string): Promise<void> {
    await assertTenantCatalogWriter(this.access, user);
    await catalogWrite(this.repository.prisma, async (tx) => {
      const before = await this.repository.findCategory(id, tx);
      if (!before) throw missing();
      if ((await this.repository.countCategoryUsage(tx, id)) > 0) {
        throw conflict(
          'CATEGORY_IN_USE',
          'Kategoride alt kategori veya ürün var; önce onları taşıyın',
        );
      }
      await this.repository.updateCategory(tx, id, { deletedAt: new Date() });
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
