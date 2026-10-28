import 'server-only';
import { Redis } from 'ioredis';
import { serverEnv } from './env';

const globalForRedis = globalThis as unknown as { tmRedis?: Redis };

/**
 * One client per process (kept on globalThis so dev hot reload does not leak
 * connections). Commands fail fast while Redis is down instead of queueing.
 */
export function redis(): Redis {
  if (!globalForRedis.tmRedis) {
    const client = new Redis(serverEnv().redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 1000,
      connectTimeout: 2000,
    });
    let down = false;
    client.on('error', (error: Error) => {
      if (!down) console.error(`[bff] Redis bağlantı hatası: ${error.message}`);
      down = true;
    });
    client.on('ready', () => {
      down = false;
    });
    globalForRedis.tmRedis = client;
  }
  return globalForRedis.tmRedis;
}

/**
 * The client, once connected. Waits briefly for the first connection (or a
 * reconnect) instead of failing the request; throws if Redis stays down.
 */
export async function readyRedis(timeoutMs = 2000): Promise<Redis> {
  const client = redis();
  if (client.status === 'ready') return client;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('ready', onReady);
      reject(new Error('Redis bağlantısı hazır değil'));
    }, timeoutMs);
    function onReady() {
      clearTimeout(timer);
      resolve();
    }
    client.once('ready', onReady);
  });
  return client;
}
