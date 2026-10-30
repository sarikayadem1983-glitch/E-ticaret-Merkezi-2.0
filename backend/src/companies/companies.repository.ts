import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { TenantContext } from '../tenancy/tenant-context.js';

export const COMPANY_FIELDS = {
  id: true,
  legalName: true,
  taxNumber: true,
  taxOffice: true,
  addressLine: true,
  district: true,
  city: true,
  postalCode: true,
  country: true,
  phone: true,
  email: true,
  eInvoiceEnabled: true,
  eInvoiceAlias: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CompanySelect;

export type CompanyRow = Prisma.CompanyGetPayload<{
  select: typeof COMPANY_FIELDS;
}>;

export interface CompanyFilter {
  /** Restricts to companies the user is assigned to; undefined = all in tenant. */
  assignedTo?: string;
  search?: string;
  isActive?: boolean;
}

/** Data access for companies and user_company_roles. Tenant-scoped by the Prisma extension. */
@Injectable()
export class CompaniesRepository {
  constructor(@InjectPrisma() readonly prisma: TenantPrismaClient) {}

  private where(filter: CompanyFilter): Prisma.CompanyWhereInput {
    return {
      isActive: filter.isActive,
      userRoles: filter.assignedTo
        ? { some: { userId: filter.assignedTo } }
        : undefined,
      OR: filter.search
        ? [
            { legalName: { contains: filter.search, mode: 'insensitive' } },
            { taxNumber: { startsWith: filter.search } },
          ]
        : undefined,
    };
  }

  async findPage(filter: CompanyFilter, page: number, perPage: number) {
    const where = this.where(filter);
    const [items, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        select: COMPANY_FIELDS,
        orderBy: [{ legalName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.company.count({ where }),
    ]);
    return { items, total };
  }

  count(filter: CompanyFilter) {
    return this.prisma.company.count({ where: this.where(filter) });
  }

  findById(id: string, filter: CompanyFilter, db: PrismaTx = this.prisma) {
    return db.company.findFirst({
      where: { id, ...this.where(filter) },
      select: COMPANY_FIELDS,
    });
  }

  findNamesByIds(ids: string[]) {
    return this.prisma.company.findMany({
      where: { id: { in: ids } },
      select: { id: true, legalName: true },
    });
  }

  findActiveByIds(ids: string[], db: PrismaTx = this.prisma) {
    return db.company.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, legalName: true },
      orderBy: [{ legalName: 'asc' }, { id: 'asc' }],
    });
  }

  create(
    tx: PrismaTx,
    data: Omit<Prisma.CompanyUncheckedCreateInput, 'tenantId'>,
  ) {
    return tx.company.create({
      data: { ...data, tenantId: TenantContext.requireTenantId() },
      select: COMPANY_FIELDS,
    });
  }

  update(tx: PrismaTx, id: string, data: Prisma.CompanyUpdateInput) {
    return tx.company.update({
      where: { id },
      data,
      select: COMPANY_FIELDS,
    });
  }
}
