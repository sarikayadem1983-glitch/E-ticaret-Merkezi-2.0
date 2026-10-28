import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

/**
 * Commands fail fast while Redis is down (no offline queue, short timeout) so
 * requests get a quick 503 instead of hanging. The client keeps reconnecting.
 */
export const redisProvider: Provider = {
  provide: REDIS,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const logger = new Logger('Redis');
    const client = new Redis(
      config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: 1000,
        connectTimeout: 2000,
      },
    );
    let down = false;
    client.on('error', (error: Error) => {
      if (!down) logger.error(`Redis connection error: ${error.message}`);
      down = true;
    });
    client.on('ready', () => {
      if (down) logger.log('Redis connection restored');
      down = false;
    });
    return client;
  },
};
