import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import type {
  CreateCompanyDto,
  ListCompaniesQuery,
  UpdateCompanyDto,
} from './companies.dto.js';
import {
  type CompanyFilter,
  CompaniesRepository,
} from './companies.repository.js';

const MODULE = 'companies';
const ENTITY = 'Company';

/** Tenant-wide access to every company; without it a user sees only assigned companies. */
export const ALL_COMPANIES = 'companies:all';

function notFound() {
  return new NotFoundException({
    code: 'NOT_FOUND',
    message: 'Firma bulunamadı',
  });
}

/**
 * Public API of the companies module. Other modules (e-invoice, orders, stock)
 * use this service and never read the companies table directly.
 */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly repository: CompaniesRepository,
    private readonly audit: AuditService,
  ) {}

  /** Users without tenant-wide access only see companies they are assigned to. */
  private scope(user: AuthUser): CompanyFilter {
    const all = user.perms.includes('*') || user.perms.includes(ALL_COMPANIES);
    return all ? {} : { assignedTo: user.sub };
  }

  async list(user: AuthUser, q: ListCompaniesQuery) {
    const { items, total } = await this.repository.findPage(
      {
        ...this.scope(user),
        search: q.search || undefined,
        isActive: q.status === 'all' ? undefined : q.status === 'active',
      },
      q.page,
      q.per_page,
    );
    return { data: items, meta: { page: q.page, per_page: q.per_page, total } };
  }

  async summary(user: AuthUser) {
    const scope = this.scope(user);
    const [active, inactive] = await Promise.all([
      this.repository.count({ ...scope, isActive: true }),
      this.repository.count({ ...scope, isActive: false }),
    ]);
    return { data: { total: active + inactive, active, inactive } };
  }

  /** Inaccessible and missing companies both answer 404, so ids reveal nothing. */
  async get(user: AuthUser, id: string) {
    const company = await this.repository.findById(id, this.scope(user));
    if (!company) throw notFound();
    return { data: company };
  }

  async create(dto: CreateCompanyDto) {
    const company = await this.repository.prisma.$transaction(async (tx) => {
      const created = await this.repository.create(tx, dto);
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
    return { data: company };
  }

  async update(user: AuthUser, id: string, dto: UpdateCompanyDto) {
    return this.change(user, id, dto);
  }

  async setActive(user: AuthUser, id: string, isActive: boolean) {
    return this.change(user, id, { isActive });
  }

  private async change(
    user: AuthUser,
    id: string,
    data: UpdateCompanyDto & { isActive?: boolean },
  ) {
    const company = await this.repository.prisma.$transaction(async (tx) => {
      const before = await this.repository.findById(id, this.scope(user), tx);
      if (!before) throw notFound();
      const after = await this.repository.update(tx, id, data);
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
    return { data: company };
  }
}
