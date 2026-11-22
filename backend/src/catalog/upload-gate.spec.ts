import { describe, expect, it } from 'vitest';
import { UploadGate } from './upload-gate.js';

describe('UploadGate (IMG-01)', () => {
  const never = () => new Promise<void>(() => {});
  const one = () => Promise.resolve(1);

  it('limits each tenant and the whole process', async () => {
    const gate = new UploadGate(3, 2);
    void gate.run('a', never);
    void gate.run('a', never);
    await expect(gate.run('a', one)).rejects.toThrow();
    void gate.run('b', never);
    await expect(gate.run('c', one)).rejects.toThrow();
  });

  it('frees the slot after success and failure', async () => {
    const gate = new UploadGate(1, 1);
    await expect(gate.run('a', one)).resolves.toBe(1);
    const failing = () => Promise.reject(new Error('x'));
    await expect(gate.run('a', failing)).rejects.toThrow('x');
    await expect(gate.run('b', one)).resolves.toBe(1);
  });
});
