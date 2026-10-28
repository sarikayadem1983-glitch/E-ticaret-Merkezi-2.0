import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service.js';

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
