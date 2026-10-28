import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthController', () => {
  const isDatabaseUp = vi.fn<() => Promise<boolean>>();
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { isDatabaseUp } }],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('returns ok when database is up', async () => {
    isDatabaseUp.mockResolvedValue(true);
    await expect(controller.check()).resolves.toEqual({
      data: { status: 'ok', database: 'up' },
    });
  });

  it('throws 503 when database is down', async () => {
    isDatabaseUp.mockResolvedValue(false);
    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
