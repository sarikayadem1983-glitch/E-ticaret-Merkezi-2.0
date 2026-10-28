import { Global, Module } from '@nestjs/common';
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
  ],
  exports: [PRISMA],
})
export class DatabaseModule {}
