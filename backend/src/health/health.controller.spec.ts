import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller.js';
import { QueueService } from '../queue/queue.service.js';
import { HealthService } from './health.service.js';

describe('HealthController', () => {
  const isDatabaseUp = vi.fn<() => Promise<boolean>>();
  const queueHealth = vi.fn<() => Promise<'up' | 'down'>>();
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthService, useValue: { isDatabaseUp } },
        { provide: QueueService, useValue: { health: queueHealth } },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  beforeEach(() => queueHealth.mockResolvedValue('up'));

  it('returns ok when database is up', async () => {
    isDatabaseUp.mockResolvedValue(true);
    await expect(controller.check()).resolves.toEqual({
      data: { status: 'ok', database: 'up', queue: 'up' },
    });
  });

  it('reports a down queue without failing the probe', async () => {
    isDatabaseUp.mockResolvedValue(true);
    queueHealth.mockResolvedValue('down');
    await expect(controller.check()).resolves.toEqual({
      data: { status: 'ok', database: 'up', queue: 'down' },
    });
  });

  it('throws 503 when database is down', async () => {
    isDatabaseUp.mockResolvedValue(false);
    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
