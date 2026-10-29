import { Module } from '@nestjs/common';
import { MembershipsRepository } from './memberships.repository.js';

/** Owns tenant_memberships. Other modules use MembershipsRepository, never the table. */
@Module({
  providers: [MembershipsRepository],
  exports: [MembershipsRepository],
})
export class MembershipsModule {}
