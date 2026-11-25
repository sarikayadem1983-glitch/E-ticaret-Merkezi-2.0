import type { ChannelAdapter, ConnectionResult } from './channel-adapter.js';
import { channelDefinition } from './channel-adapter.js';
import { SyncError, httpFailure } from '../sync/sync-errors.js';

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

  /**
   * INT-TY-01a: one page of the seller's products (read-only). Only the fields
   * needed for matching are kept; anything else in the response is dropped.
   * Non-2xx → SyncError via httpFailure; credentials never appear in errors.
   */
  async listProducts(
    credentials: Readonly<Record<string, string>>,
    page: number,
    size: number,
  ): Promise<TrendyolProductPage> {
    const { supplierId, apiKey, apiSecret } = credentials;
    if (
      !supplierId ||
      !apiKey ||
      !apiSecret ||
      !/^\d{1,20}$/.test(supplierId)
    ) {
      throw new SyncError('CHANNEL_AUTH_FAILED', 'auth');
    }
    const url = `${this.baseUrl}/integration/product/sellers/${supplierId}/products?page=${page}&size=${size}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
          'User-Agent': `${supplierId} - SelfIntegration`,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new SyncError('CHANNEL_TIMEOUT', 'transient');
    }
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel();
      throw httpFailure(res.status, res.headers.get('retry-after'));
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new SyncError('CHANNEL_BAD_RESPONSE', 'transient');
    }
    return parseProductPage(body);
  }

  /** INT-TY-02b: the seller's product with this barcode (read-only), or null. */
  async findByBarcode(
    credentials: Readonly<Record<string, string>>,
    barcode: string,
  ): Promise<TrendyolProduct | null> {
    const page = await this.getJson(
      credentials,
      (id) =>
        `/integration/product/sellers/${id}/products?page=0&size=1&barcode=${encodeURIComponent(barcode)}`,
    );
    const item = parseProductPage(page).items.find(
      (i) => i.barcode === barcode,
    );
    return item ?? null;
  }

  /**
   * INT-TY-02b: WRITES stock and price to Trendyol (updatePriceAndInventory,
   * at most 1000 items). Returns Trendyol's batch request id; the outcome per
   * item comes from getBatchResult. Values are absolute, so a retry is safe.
   */
  async updatePriceAndInventory(
    credentials: Readonly<Record<string, string>>,
    items: readonly TrendyolStockPriceItem[],
  ): Promise<string> {
    if (items.length === 0 || items.length > 1000) {
      throw new SyncError('SYNC_INVALID_PAYLOAD', 'permanent');
    }
    const body = await this.request(
      credentials,
      (id) =>
        `/integration/inventory/sellers/${id}/products/price-and-inventory`,
      'POST',
      { items },
    );
    const batchId = str(
      (body as { batchRequestId?: unknown })?.batchRequestId,
      100,
    );
    if (!batchId || !/^[A-Za-z0-9-]{1,100}$/.test(batchId)) {
      throw new SyncError('CHANNEL_BAD_RESPONSE', 'transient');
    }
    return batchId;
  }

  /** INT-TY-02b: per-item outcome of a batch request (read-only). */
  async getBatchResult(
    credentials: Readonly<Record<string, string>>,
    batchRequestId: string,
  ): Promise<TrendyolBatchResult> {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(batchRequestId)) {
      throw new SyncError('SYNC_INVALID_PAYLOAD', 'permanent');
    }
    const body = await this.getJson(
      credentials,
      (id) =>
        `/integration/product/sellers/${id}/products/batch-requests/${batchRequestId}`,
    );
    return parseBatchResult(body);
  }

  private getJson(
    credentials: Readonly<Record<string, string>>,
    path: (supplierId: string) => string,
  ): Promise<unknown> {
    return this.request(credentials, path, 'GET');
  }

  private async request(
    credentials: Readonly<Record<string, string>>,
    path: (supplierId: string) => string,
    method: 'GET' | 'POST',
    payload?: unknown,
  ): Promise<unknown> {
    const { supplierId, apiKey, apiSecret } = credentials;
    if (
      !supplierId ||
      !apiKey ||
      !apiSecret ||
      !/^\d{1,20}$/.test(supplierId)
    ) {
      throw new SyncError('CHANNEL_AUTH_FAILED', 'auth');
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path(supplierId)}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
          'User-Agent': `${supplierId} - SelfIntegration`,
          Accept: 'application/json',
          ...(payload !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new SyncError('CHANNEL_TIMEOUT', 'transient');
    }
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel();
      throw httpFailure(res.status, res.headers.get('retry-after'));
    }
    try {
      return await res.json();
    } catch {
      throw new SyncError('CHANNEL_BAD_RESPONSE', 'transient');
    }
  }
}

export interface TrendyolStockPriceItem {
  barcode: string;
  quantity: number;
  /** VAT-inclusive, 2 decimals. */
  salePrice: number;
  /** Must not be lower than salePrice. */
  listPrice: number;
}

export type BatchItemStatus = 'SUCCESS' | 'FAILED' | 'PENDING';

export interface TrendyolBatchResult {
  /** True when Trendyol finished processing every item. */
  completed: boolean;
  /** Per barcode; failure reasons are marketplace text and are dropped. */
  items: { barcode: string; status: BatchItemStatus }[];
}

/** Exported for tests. */
export function parseBatchResult(body: unknown): TrendyolBatchResult {
  const b = body as { status?: unknown; items?: unknown } | null;
  if (!b || typeof b !== 'object') {
    throw new SyncError('CHANNEL_BAD_RESPONSE', 'transient');
  }
  const items: TrendyolBatchResult['items'] = [];
  for (const raw of Array.isArray(b.items)
    ? (b.items as (Record<string, unknown> | null)[])
    : []) {
    if (!raw || typeof raw !== 'object') continue;
    const req = raw.requestItem as Record<string, unknown> | undefined;
    const barcode = str(req?.barcode ?? raw.barcode, 50);
    if (!barcode) continue;
    const st = typeof raw.status === 'string' ? raw.status.toUpperCase() : '';
    items.push({
      barcode,
      status:
        st === 'SUCCESS' ? 'SUCCESS' : st === 'FAILED' ? 'FAILED' : 'PENDING',
    });
  }
  const status = typeof b.status === 'string' ? b.status.toUpperCase() : '';
  return {
    completed:
      status === 'COMPLETED' ||
      (items.length > 0 && items.every((i) => i.status !== 'PENDING')),
    items,
  };
}

export interface TrendyolProduct {
  barcode: string;
  stockCode: string | null;
  title: string | null;
  productMainId: string | null;
  approved: boolean | null;
  lastUpdateDate: Date | null;
  /** KDV percent as given by Trendyol (e.g. 20); null when absent. */
  vatRate: number | null;
  /** Stock on Trendyol (non-negative integer); null when absent/invalid. */
  quantity: number | null;
  /** VAT-inclusive sale price as a 2-digit decimal string ("199.90"); null when absent/invalid. */
  salePrice: string | null;
  /** VAT-inclusive list (strike-through) price, same format; null when absent/invalid. */
  listPrice: string | null;
}

/** Number → "123.45" (≥ 0, ≤ NUMERIC(12,2)); anything else null. */
export function priceString(v: unknown): string | null {
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < 0 ||
    v > 9_999_999_999.99
  ) {
    return null;
  }
  return (Math.round(v * 100) / 100).toFixed(2);
}

export interface TrendyolProductPage {
  items: TrendyolProduct[];
  totalPages: number;
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;

/** Exported for tests. Rejects a body without a content array; skips items without a barcode. */
export function parseProductPage(body: unknown): TrendyolProductPage {
  const b = body as { content?: unknown; totalPages?: unknown } | null;
  if (!b || !Array.isArray(b.content)) {
    throw new SyncError('CHANNEL_BAD_RESPONSE', 'transient');
  }
  const items: TrendyolProduct[] = [];
  for (const raw of b.content as (Record<string, unknown> | null)[]) {
    if (!raw || typeof raw !== 'object') continue;
    const barcode = str(raw.barcode, 50);
    if (!barcode) continue;
    const ts = raw.lastUpdateDate;
    items.push({
      barcode,
      stockCode: str(raw.stockCode, 100),
      title: str(raw.title, 250),
      productMainId: str(raw.productMainId, 100),
      approved: typeof raw.approved === 'boolean' ? raw.approved : null,
      lastUpdateDate:
        typeof ts === 'number' && Number.isFinite(ts) ? new Date(ts) : null,
      vatRate:
        typeof raw.vatRate === 'number' && Number.isFinite(raw.vatRate)
          ? raw.vatRate
          : null,
      quantity:
        typeof raw.quantity === 'number' &&
        Number.isInteger(raw.quantity) &&
        raw.quantity >= 0 &&
        raw.quantity <= 1_000_000_000
          ? raw.quantity
          : null,
      salePrice: priceString(raw.salePrice),
      listPrice: priceString(raw.listPrice),
    });
  }
  const tp = Number(b.totalPages);
  return {
    items,
    totalPages: Number.isInteger(tp) && tp >= 0 ? Math.min(tp, 10_000) : 0,
  };
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
