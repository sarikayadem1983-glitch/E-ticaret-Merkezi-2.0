import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { HealthService } from './health.service.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check() {
    const database = await this.healthService.isDatabaseUp();
    if (!database) {
      throw new ServiceUnavailableException('Veritabanına ulaşılamıyor');
    }
    return { data: { status: 'ok', database: 'up' } };
  }
}
