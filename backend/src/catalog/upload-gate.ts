import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Bounds how many uploads this process buffers and decodes at once, in total and per
 * tenant, so one store can neither exhaust memory nor take every slot. No queue: a busy
 * server answers 503 and the client retries.
 */
export class UploadGate {
  private readonly active = new Map<string, number>();
  private total = 0;

  constructor(
    private readonly maxTotal: number,
    private readonly maxPerTenant: number,
  ) {}

  async run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const own = this.active.get(tenantId) ?? 0;
    if (this.total >= this.maxTotal || own >= this.maxPerTenant) {
      throw new ServiceUnavailableException({
        code: 'UPLOAD_BUSY',
        message: 'Çok sayıda yükleme sürüyor, biraz sonra tekrar deneyin',
      });
    }
    this.total++;
    this.active.set(tenantId, own + 1);
    try {
      return await fn();
    } finally {
      this.total--;
      const left = (this.active.get(tenantId) ?? 1) - 1;
      if (left === 0) this.active.delete(tenantId);
      else this.active.set(tenantId, left);
    }
  }
}
