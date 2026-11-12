import { Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import type {
  CreateAttributeDto,
  CreateAttributeValueDto,
  ListCatalogQuery,
  UpdateAttributeDto,
  UpdateAttributeValueDto,
} from './catalog.dto.js';
import { conflict, notFound } from './catalog.errors.js';
import { AttributesRepository } from './attributes.repository.js';
import {
  assertTenantCatalogWriter,
  catalogWrite,
  MODULE,
} from './catalog.tx.js';

const ATTRIBUTE = 'Attribute';
const VALUE = 'AttributeValue';
const missing = () => notFound('Özellik bulunamadı');
const missingValue = () => notFound('Özellik değeri bulunamadı');

/** Values compared like the database index: trimmed, case-insensitive (Turkish rules). */
const norm = (v: string) => v.trim().toLocaleLowerCase('tr');

/** Tenant-wide variant attributes (colour, size…) and their values (CAT-03). */
@Injectable()
export class AttributesService {
  constructor(
    private readonly repository: AttributesRepository,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async list(q: ListCatalogQuery) {
    const { items, total } = await this.repository.findPage(
      q.search || undefined,
      q.page,
      q.per_page,
    );
    return { data: items, meta: { page: q.page, per_page: q.per_page, total } };
  }

  async get(id: string) {
    const attribute = await this.repository.find(id);
    if (!attribute) throw missing();
    return { data: attribute };
  }

  async create(user: AuthUser, dto: CreateAttributeDto) {
    await assertTenantCatalogWriter(this.access, user);
    const values = dto.values ?? [];
    if (new Set(values.map(norm)).size !== values.length) {
      throw conflict('ATTRIBUTE_VALUE_TAKEN', 'Aynı değer iki kez verilmiş');
    }
    const attribute = await catalogWrite(this.repository.prisma, async (tx) => {
      const created = await this.repository.create(tx, dto.name, values);
      await this.audit.record(
        {
          action: 'CREATE',
          module: MODULE,
          entityType: ATTRIBUTE,
          entityId: created.id,
          after: created,
        },
        tx,
      );
      return created;
    });
    return { data: attribute };
  }

  async update(user: AuthUser, id: string, dto: UpdateAttributeDto) {
    await assertTenantCatalogWriter(this.access, user);
    const attribute = await catalogWrite(this.repository.prisma, async (tx) => {
      const before = await this.repository.find(id, tx);
      if (!before) throw missing();
      const after = await this.repository.update(tx, id, { name: dto.name });
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: ATTRIBUTE,
          entityId: id,
          before,
          after,
        },
        tx,
      );
      return after;
    });
    return { data: attribute };
  }

  /** Soft delete with its values. Refused while an active variant carries the attribute. */
  async remove(user: AuthUser, id: string): Promise<void> {
    await assertTenantCatalogWriter(this.access, user);
    await catalogWrite(this.repository.prisma, async (tx) => {
      const before = await this.repository.find(id, tx);
      if (!before) throw missing();
      if ((await this.repository.countAttributeUsage(tx, id)) > 0) {
        throw conflict(
          'ATTRIBUTE_IN_USE',
          'Bu özelliği kullanan varyant var; önce varyantları silin',
        );
      }
      await this.repository.softDelete(tx, id);
      await this.audit.record(
        {
          action: 'DELETE',
          module: MODULE,
          entityType: ATTRIBUTE,
          entityId: id,
          before,
        },
        tx,
      );
    });
  }

  // ---- values ----

  async addValue(user: AuthUser, id: string, dto: CreateAttributeValueDto) {
    await assertTenantCatalogWriter(this.access, user);
    const attribute = await catalogWrite(this.repository.prisma, async (tx) => {
      if (!(await this.repository.find(id, tx))) throw missing();
      const sortOrder =
        dto.sortOrder ?? (await this.repository.nextSortOrder(tx, id));
      const created = await this.repository.createValue(
        tx,
        id,
        dto.value,
        sortOrder,
      );
      await this.audit.record(
        {
          action: 'CREATE',
          module: MODULE,
          entityType: VALUE,
          entityId: created.id,
          after: { ...created, attributeId: id },
        },
        tx,
      );
      return this.repository.find(id, tx);
    });
    return { data: attribute };
  }

  async updateValue(
    user: AuthUser,
    id: string,
    valueId: string,
    dto: UpdateAttributeValueDto,
  ) {
    await assertTenantCatalogWriter(this.access, user);
    const attribute = await catalogWrite(this.repository.prisma, async (tx) => {
      if (!(await this.repository.find(id, tx))) throw missing();
      const before = await this.repository.findValue(id, valueId, tx);
      if (!before) throw missingValue();
      const after = await this.repository.updateValue(tx, valueId, {
        value: dto.value,
        sortOrder: dto.sortOrder,
      });
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: VALUE,
          entityId: valueId,
          before: { ...before, attributeId: id },
          after: { ...after, attributeId: id },
        },
        tx,
      );
      return this.repository.find(id, tx);
    });
    return { data: attribute };
  }

  async removeValue(user: AuthUser, id: string, valueId: string) {
    await assertTenantCatalogWriter(this.access, user);
    await catalogWrite(this.repository.prisma, async (tx) => {
      if (!(await this.repository.find(id, tx))) throw missing();
      const before = await this.repository.findValue(id, valueId, tx);
      if (!before) throw missingValue();
      if ((await this.repository.countValueUsage(tx, valueId)) > 0) {
        throw conflict(
          'ATTRIBUTE_VALUE_IN_USE',
          'Bu değeri kullanan varyant var; önce varyantları silin',
        );
      }
      await this.repository.updateValue(tx, valueId, { deletedAt: new Date() });
      await this.audit.record(
        {
          action: 'DELETE',
          module: MODULE,
          entityType: VALUE,
          entityId: valueId,
          before: { ...before, attributeId: id },
        },
        tx,
      );
    });
  }
}
