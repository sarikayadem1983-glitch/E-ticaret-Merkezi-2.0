import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantContext } from '../tenancy/tenant-context.js';
import { InjectPrisma, type TenantPrismaClient } from './prisma.service.js';

interface RoleRow {
  role: string;
  superuser: boolean;
  bypassrls: boolean;
  owns_tables: boolean;
}

/** Refuses to start in production when the app connects with a privileged database role. */
@Injectable()
export class DatabaseRoleCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseRoleCheck.name);

  constructor(
    @InjectPrisma() private readonly prisma: TenantPrismaClient,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const [row] = await TenantContext.runAsSystem(
      () => this.prisma.$queryRaw<RoleRow[]>`
        SELECT current_user AS role,
               r.rolsuper AS superuser,
               r.rolbypassrls AS bypassrls,
               EXISTS (
                 SELECT 1 FROM pg_class c
                 WHERE c.relnamespace = 'public'::regnamespace
                   AND c.relkind = 'r'
                   AND pg_has_role(current_user, c.relowner, 'MEMBER')
               ) AS owns_tables
        FROM pg_roles r WHERE r.rolname = current_user`,
    );

    const problems = [
      row.superuser && 'superuser',
      row.bypassrls && 'BYPASSRLS',
      row.owns_tables && 'tablo sahibi',
    ].filter(Boolean);
    if (problems.length === 0) return;

    const message = `Veritabanı rolü '${row.role}' fazla yetkili (${problems.join(', ')}). DATABASE_URL en az yetkili uygulama rolünü (tm_app) kullanmalı.`;
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new Error(message);
    }
    this.logger.warn(message);
  }
}
