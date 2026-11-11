import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { TenantContext } from '../tenancy/tenant-context.js';

const ACTIVE = { deletedAt: null };

export const ATTRIBUTE_VALUE_FIELDS = {
  id: true,
  value: true,
  sortOrder: true,
} satisfies Prisma.AttributeValueSelect;

export const ATTRIBUTE_FIELDS = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  values: {
    where: ACTIVE,
    select: ATTRIBUTE_VALUE_FIELDS,
    orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.AttributeSelect;

export type AttributeRow = Prisma.AttributeGetPayload<{
  select: typeof ATTRIBUTE_FIELDS;
}>;

/** A variant still counts as "using" a value only while it is not soft-deleted. */
const USED_BY_ACTIVE_VARIANT = { variant: ACTIVE };

/**
 * Data access for attributes, attribute_values and their usage by variants
 * (CAT-03). Tenant-scoped by the Prisma extension; soft-deleted rows are
 * never returned.
 */
@Injectable()
export class AttributesRepository {
  constructor(@InjectPrisma() readonly prisma: TenantPrismaClient) {}

  async findPage(search: string | undefined, page: number, perPage: number) {
    const where: Prisma.AttributeWhereInput = {
      ...ACTIVE,
      name: search ? { contains: search, mode: 'insensitive' } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.attribute.findMany({
        where,
        select: ATTRIBUTE_FIELDS,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.attribute.count({ where }),
    ]);
    return { items, total };
  }

  find(id: string, db: PrismaTx = this.prisma) {
    return db.attribute.findFirst({
      where: { id, ...ACTIVE },
      select: ATTRIBUTE_FIELDS,
    });
  }

  async create(
    tx: PrismaTx,
    name: string,
    values: string[],
  ): Promise<AttributeRow> {
    const tenantId = TenantContext.requireTenantId();
    const { id } = await tx.attribute.create({
      data: { tenantId, name },
      select: { id: true },
    });
    if (values.length > 0) {
      await tx.attributeValue.createMany({
        data: values.map((value, i) => ({
          tenantId,
          attributeId: id,
          value,
          sortOrder: i,
        })),
      });
    }
    return (await this.find(id, tx)) as AttributeRow;
  }

  update(tx: PrismaTx, id: string, data: Prisma.AttributeUncheckedUpdateInput) {
    return tx.attribute.update({
      where: { id },
      data,
      select: ATTRIBUTE_FIELDS,
    });
  }

  /** Soft-deletes the attribute and its active values. */
  async softDelete(tx: PrismaTx, id: string) {
    const deletedAt = new Date();
    await tx.attributeValue.updateMany({
      where: { attributeId: id, ...ACTIVE },
      data: { deletedAt },
    });
    await tx.attribute.update({
      where: { id },
      data: { deletedAt },
      select: { id: true },
    });
  }

  countAttributeUsage(tx: PrismaTx, attributeId: string) {
    return tx.variantAttributeValue.count({
      where: { attributeId, ...USED_BY_ACTIVE_VARIANT },
    });
  }

  countValueUsage(tx: PrismaTx, attributeValueId: string) {
    return tx.variantAttributeValue.count({
      where: { attributeValueId, ...USED_BY_ACTIVE_VARIANT },
    });
  }

  findValue(attributeId: string, id: string, db: PrismaTx = this.prisma) {
    return db.attributeValue.findFirst({
      where: { id, attributeId, ...ACTIVE },
      select: ATTRIBUTE_VALUE_FIELDS,
    });
  }

  async nextSortOrder(tx: PrismaTx, attributeId: string): Promise<number> {
    const last = await tx.attributeValue.findFirst({
      where: { attributeId, ...ACTIVE },
      select: { sortOrder: true },
      orderBy: { sortOrder: 'desc' },
    });
    return last ? Math.min(last.sortOrder + 1, 10000) : 0;
  }

  createValue(
    tx: PrismaTx,
    attributeId: string,
    value: string,
    sortOrder: number,
  ) {
    return tx.attributeValue.create({
      data: {
        tenantId: TenantContext.requireTenantId(),
        attributeId,
        value,
        sortOrder,
      },
      select: ATTRIBUTE_VALUE_FIELDS,
    });
  }

  updateValue(
    tx: PrismaTx,
    id: string,
    data: Prisma.AttributeValueUncheckedUpdateInput,
  ) {
    return tx.attributeValue.update({
      where: { id },
      data,
      select: ATTRIBUTE_VALUE_FIELDS,
    });
  }

  /** Active values (of active attributes) among `ids`, with their attribute and display text. */
  findActiveValues(tx: PrismaTx, ids: string[]) {
    return tx.attributeValue.findMany({
      where: { id: { in: ids }, ...ACTIVE, attribute: ACTIVE },
      select: { id: true, attributeId: true, value: true },
    });
  }
}
