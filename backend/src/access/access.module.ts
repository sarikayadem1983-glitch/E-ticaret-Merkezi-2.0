import { Module } from '@nestjs/common';
import { AccessRepository } from './access.repository.js';
import { AccessService } from './access.service.js';
import { SystemRolesCheck } from './system-roles.check.js';

/** Role catalog and access decisions. Other modules use AccessService. */
@Module({
  providers: [AccessRepository, AccessService, SystemRolesCheck],
  exports: [AccessService],
})
export class AccessModule {}
