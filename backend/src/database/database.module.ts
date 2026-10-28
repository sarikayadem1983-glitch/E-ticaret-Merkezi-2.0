import { Global, Module } from '@nestjs/common';
import { DatabaseRoleCheck } from './database-role.check.js';
import { PRISMA, PrismaLifecycle } from './prisma.service.js';

@Global()
@Module({
  providers: [
    PrismaLifecycle,
    {
      provide: PRISMA,
      inject: [PrismaLifecycle],
      useFactory: (lifecycle: PrismaLifecycle) => lifecycle.client,
    },
    DatabaseRoleCheck,
  ],
  exports: [PRISMA],
})
export class DatabaseModule {}
