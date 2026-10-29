import { Global, Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module.js';
import { QueueService } from './queue.service.js';

/** Global: any module may enqueue or register a handler via QueueService. */
@Global()
@Module({
  imports: [TenantsModule],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
