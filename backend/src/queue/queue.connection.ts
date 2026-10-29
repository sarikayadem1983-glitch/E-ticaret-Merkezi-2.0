import { Redis } from 'ioredis';

/** Key prefix of every queue key in Redis (`queue:<name>:...`). */
export const QUEUE_PREFIX = 'queue';
export const CONNECT_TIMEOUT_MS = 2000;
/** Upper bound for one enqueue, including a connection that is still coming up. */
export const ENQUEUE_TIMEOUT_MS = 2000;

/**
 * Producer connection, same fail-fast settings as backend/src/rate-limit/redis.provider.ts:
 * no offline queue, one retry, short command timeout. While Redis is down,
 * enqueue fails within ENQUEUE_TIMEOUT_MS instead of hanging the request.
 */
export function producerConnection(url: string): Redis {
  return new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 1000,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
}

/**
 * Worker connection. BullMQ workers use blocking commands and require
 * `maxRetriesPerRequest: null`; while Redis is down the worker waits and
 * reconnects (jobs live in Redis, none is lost). It never serves HTTP
 * requests, so waiting here cannot hang a request.
 */
export function workerConnection(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
}
