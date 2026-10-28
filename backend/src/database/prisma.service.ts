import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { tenantExtension } from '../tenancy/tenant-prisma.extension.js';

function createClient(databaseUrl: string) {
  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  return { base, scoped: base.$extends(tenantExtension) };
}

export type TenantPrismaClient = ReturnType<typeof createClient>['scoped'];

/** Injection token for the tenant-scoped client. No unscoped client is exported. */
export const PRISMA = Symbol('PRISMA');
export const InjectPrisma = () => Inject(PRISMA);

@Injectable()
export class PrismaLifecycle implements OnModuleDestroy {
  readonly client: TenantPrismaClient;
  private readonly base: PrismaClient;

  constructor(config: ConfigService) {
    const { base, scoped } = createClient(
      config.getOrThrow<string>('DATABASE_URL'),
    );
    this.base = base;
    this.client = scoped;
  }

  async onModuleDestroy() {
    await this.base.$disconnect();
  }
}
