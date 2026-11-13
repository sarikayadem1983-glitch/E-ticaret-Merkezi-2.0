import type { ChannelAdapter, ConnectionResult } from './channel-adapter.js';
import { channelDefinition } from './channel-adapter.js';

const DEFAULT_BASE = 'https://apigw.trendyol.com';
const TIMEOUT_MS = 10_000;

/**
 * Trendyol adapter (INT-03: connection test only; product/stock/order calls
 * come with INT-TY-01…03). Read-only: lists one product. Credentials are used
 * for the request header only and never logged or returned; response bodies
 * are not read.
 */
export class TrendyolAdapter implements ChannelAdapter {
  readonly definition = channelDefinition('trendyol')!;

  constructor(
    private readonly baseUrl: string = DEFAULT_BASE,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async testConnection(
    credentials: Readonly<Record<string, string>>,
  ): Promise<ConnectionResult> {
    const { supplierId, apiKey, apiSecret } = credentials;
    if (
      !supplierId ||
      !apiKey ||
      !apiSecret ||
      !/^\d{1,20}$/.test(supplierId)
    ) {
      return { ok: false, code: 'INVALID_CREDENTIALS' };
    }
    const url = `${this.baseUrl}/integration/product/sellers/${supplierId}/products?page=0&size=1`;
    let status: number;
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
          'User-Agent': `${supplierId} - SelfIntegration`,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      await res.body?.cancel();
    } catch {
      return { ok: false, code: 'UNAVAILABLE' };
    }
    if (status >= 200 && status < 300) return { ok: true };
    if (status === 401) return { ok: false, code: 'INVALID_CREDENTIALS' };
    if (status === 403) return { ok: false, code: 'FORBIDDEN' };
    if (status === 429 || status >= 500)
      return { ok: false, code: 'UNAVAILABLE' };
    return { ok: false, code: 'UNKNOWN' };
  }
}

/** Only https, or http to a loopback host (tests with a fake server). */
export function trendyolBaseUrl(value: string | undefined): string {
  if (!value) return DEFAULT_BASE;
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('TRENDYOL_API_BASE https olmalı');
  }
  return value.replace(/\/+$/, '');
}
