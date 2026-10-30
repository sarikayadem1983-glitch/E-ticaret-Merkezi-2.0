import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { QueueService } from '../queue/queue.service.js';
import { HealthService } from './health.service.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly queue: QueueService,
  ) {}

  /**
   * 503 only when the database is down. Queue Redis is reported but does not
   * fail the probe: the API keeps serving reads while background jobs wait.
   */
  @Get()
  async check() {
    const [database, queue] = await Promise.all([
      this.healthService.isDatabaseUp(),
      this.queue.health(),
    ]);
    if (!database) {
      throw new ServiceUnavailableException('Veritabanına ulaşılamıyor');
    }
    return { data: { status: 'ok', database: 'up', queue } };
  }
}
