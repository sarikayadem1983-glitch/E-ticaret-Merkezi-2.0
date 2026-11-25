import { describe, expect, it, vi } from 'vitest';
import { TrendyolAdapter } from './trendyol.adapter.js';

const creds = { supplierId: '123', apiKey: 'k', apiSecret: 's' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('TrendyolAdapter writes (INT-TY-02b)', () => {
  it('posts price-and-inventory and returns the batch id', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(json({ batchRequestId: 'abc-123' })),
    );
    const a = new TrendyolAdapter('https://x.test', fetchImpl as never);
    const items = [
      { barcode: 'B1', quantity: 2, salePrice: 10, listPrice: 12 },
    ];
    expect(await a.updatePriceAndInventory(creds, items)).toBe('abc-123');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://x.test/integration/inventory/sellers/123/products/price-and-inventory',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ items });
    expect(init.redirect).toBe('error');
  });

  it('rejects empty or oversized batches without calling Trendyol', async () => {
    const fetchImpl = vi.fn();
    const a = new TrendyolAdapter('https://x.test', fetchImpl as never);
    await expect(a.updatePriceAndInventory(creds, [])).rejects.toThrow(
      'SYNC_INVALID_PAYLOAD',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps HTTP errors and bad batch ids, never echoing the body', async () => {
    const a401 = new TrendyolAdapter('https://x.test', (() =>
      Promise.resolve(json({ msg: 'secret' }, 401))) as never);
    await expect(
      a401.updatePriceAndInventory(creds, [
        { barcode: 'B', quantity: 1, salePrice: 1, listPrice: 1 },
      ]),
    ).rejects.toThrow('CHANNEL_AUTH_FAILED');
    const bad = new TrendyolAdapter('https://x.test', (() =>
      Promise.resolve(json({ batchRequestId: '../x' }))) as never);
    await expect(
      bad.updatePriceAndInventory(creds, [
        { barcode: 'B', quantity: 1, salePrice: 1, listPrice: 1 },
      ]),
    ).rejects.toThrow('CHANNEL_BAD_RESPONSE');
  });

  it('finds a product by barcode with its list price', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        json({
          totalPages: 1,
          content: [{ barcode: 'B 1', salePrice: 90, listPrice: 120.5 }],
        }),
      ),
    );
    const a = new TrendyolAdapter('https://x.test', fetchImpl as never);
    expect(await a.findByBarcode(creds, 'B 1')).toMatchObject({
      barcode: 'B 1',
      salePrice: '90.00',
      listPrice: '120.50',
    });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain(
      'barcode=B%201',
    );
  });

  it('refuses an unsafe batch id before calling Trendyol', async () => {
    const fetchImpl = vi.fn();
    const a = new TrendyolAdapter('https://x.test', fetchImpl as never);
    await expect(a.getBatchResult(creds, '../../x')).rejects.toThrow(
      'SYNC_INVALID_PAYLOAD',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
