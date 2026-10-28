import { Module } from '@nestjs/common';
import { TenantsRepository } from './tenants.repository.js';
import { TenantsService } from './tenants.service.js';

@Module({
  providers: [TenantsRepository, TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
