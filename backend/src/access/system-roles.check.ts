import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AccessRepository } from './access.repository.js';

/** Logs tenants missing a catalog role at startup. Never blocks startup. */
@Injectable()
export class SystemRolesCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemRolesCheck.name);

  constructor(private readonly repository: AccessRepository) {}

  async onApplicationBootstrap() {
    try {
      const missing = await this.repository.findMissingSystemRoles();
      for (const { tenantId, key } of missing) {
        this.logger.warn(`Sistem rolü eksik: tenant ${tenantId}, rol ${key}`);
      }
    } catch (error) {
      this.logger.error(
        `Sistem rolü kontrolü yapılamadı: ${(error as Error).message}`,
      );
    }
  }
}
