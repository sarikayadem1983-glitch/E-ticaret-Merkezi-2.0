import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

const CONNECT_TIMEOUT_MS = 2000;

/**
 * Resolves once the client is ready, or after `timeoutMs` / a connection error.
 * Without this, the first commands of a freshly booted app race the initial
 * connect: with the offline queue disabled they fail immediately ("Stream isn't
 * writeable and enableOfflineQueue options is false") and the request gets 503.
 */
export function waitForReady(
  client: Redis,
  timeoutMs: number,
): Promise<boolean> {
  if (client.status === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ready: boolean) => {
      clearTimeout(timer);
      client.off('ready', onReady);
      client.off('error', onError);
      resolve(ready);
    };
    const onReady = () => done(true);
    const onError = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    client.once('ready', onReady);
    client.once('error', onError);
  });
}

/**
 * Commands fail fast while Redis is down (no offline queue, short timeout) so
 * requests get a quick 503 instead of hanging. The client keeps reconnecting.
 * Startup waits for the first connection (bounded) so the app does not serve
 * requests before Redis is ready; if Redis is down at startup the app still
 * starts and auth endpoints fail closed until it comes back.
 */
export const redisProvider: Provider = {
  provide: REDIS,
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => {
    const logger = new Logger('Redis');
    const client = new Redis(
      config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: 1000,
        connectTimeout: CONNECT_TIMEOUT_MS,
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
    if (!(await waitForReady(client, CONNECT_TIMEOUT_MS))) {
      logger.error(
        'Redis is not ready at startup; auth endpoints will return 503 until it connects',
      );
    }
    return client;
  },
};
