import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';

@Injectable()
export class HealthService {
  constructor(@InjectPrisma() private readonly prisma: TenantPrismaClient) {}

  async isDatabaseUp(): Promise<boolean> {
    try {
      await TenantContext.runAsSystem(() => this.prisma.$queryRaw`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }
}
