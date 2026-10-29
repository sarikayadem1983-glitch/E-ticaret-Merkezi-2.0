import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { waitForReady } from './redis.provider.js';

const fake = (status: string) =>
  Object.assign(new EventEmitter(), { status }) as unknown as Redis;

describe('waitForReady', () => {
  it('resolves true at once when already ready', async () => {
    await expect(waitForReady(fake('ready'), 10)).resolves.toBe(true);
  });

  it('waits for the ready event while connecting', async () => {
    const client = fake('connecting');
    const ready = waitForReady(client, 1000);
    (client as unknown as EventEmitter).emit('ready');
    await expect(ready).resolves.toBe(true);
  });

  it('resolves false on a connection error', async () => {
    const client = fake('connecting');
    const ready = waitForReady(client, 1000);
    (client as unknown as EventEmitter).emit('error', new Error('down'));
    await expect(ready).resolves.toBe(false);
  });

  it('resolves false after the timeout', async () => {
    await expect(waitForReady(fake('connecting'), 5)).resolves.toBe(false);
  });
});
