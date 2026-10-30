import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * Member list, access editing and deactivation (USR-T11a). Owns no table:
 * memberships, roles, companies and refresh tokens are changed through their
 * modules' services.
 */
@Module({
  imports: [AccessModule, AuthModule, CompaniesModule, MembershipsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
