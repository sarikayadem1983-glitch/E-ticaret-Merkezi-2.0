import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import type { PrismaTx } from '../database/prisma.types.js';
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
    private readonly access: AccessService,
  ) {}

  /**
   * Users without a tenant role only see companies they are assigned to. Read
   * from the database on every request, not from the JWT `perms`.
   */
  private async scope(user: AuthUser): Promise<CompanyFilter> {
    return (await this.access.seesAllCompanies(user.sub))
      ? {}
      : { assignedTo: user.sub };
  }

  /**
   * The active companies of the current tenant among `ids` (others, inactive
   * ones and ids of other tenants are left out). For other modules, e.g.
   * invitations, that must not read the companies table.
   */
  activeByIds(
    ids: string[],
    db?: PrismaTx,
  ): Promise<{ id: string; legalName: string }[]> {
    return this.repository.findActiveByIds(ids, db);
  }

  /** Legal names of the current tenant's companies among `ids`, active or not. */
  async namesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.repository.findNamesByIds(ids);
    return new Map(rows.map((r) => [r.id, r.legalName]));
  }

  async list(user: AuthUser, q: ListCompaniesQuery) {
    const { items, total } = await this.repository.findPage(
      {
        ...(await this.scope(user)),
        search: q.search || undefined,
        isActive: q.status === 'all' ? undefined : q.status === 'active',
      },
      q.page,
      q.per_page,
    );
    return { data: items, meta: { page: q.page, per_page: q.per_page, total } };
  }

  async summary(user: AuthUser) {
    const scope = await this.scope(user);
    const [active, inactive] = await Promise.all([
      this.repository.count({ ...scope, isActive: true }),
      this.repository.count({ ...scope, isActive: false }),
    ]);
    return { data: { total: active + inactive, active, inactive } };
  }

  /** Inaccessible and missing companies both answer 404, so ids reveal nothing. */
  async get(user: AuthUser, id: string) {
    const company = await this.repository.findById(id, await this.scope(user));
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
    // The member's role in this company, from the database: none → 404,
    // read-only → 403. Stale JWT perms cannot bypass it.
    await this.access.assertCompanyPermission(user, id, 'companies:write');
    const company = await this.repository.prisma.$transaction(async (tx) => {
      const before = await this.repository.findById(id, {}, tx);
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
