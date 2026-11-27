import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { buildStockReport, type VariantInput } from './stock-report.js';

const variant = (
  id: string,
  cost: string | null,
  companyId = 'c1',
): VariantInput => ({
  id,
  companyId,
  sku: id.toUpperCase(),
  name: `Ürün ${id}`,
  purchaseCost: cost === null ? null : new Prisma.Decimal(cost),
  costCurrency: cost === null ? null : 'TRY',
});
const all = () => true;
const level = (variantId: string, onHand: number, reserved = 0) => ({
  variantId,
  onHand,
  reserved,
});

describe('buildStockReport', () => {
  it('sums warehouses and values stock at the current cost', () => {
    const r = buildStockReport(
      [variant('a', '10.50')],
      [level('a', 3, 1), level('a', 2)],
      [],
      30,
      all,
    );
    expect(r.rows[0]).toMatchObject({
      onHand: 5,
      available: 4,
      value: '52.50',
      unitCost: '10.50',
      currency: 'TRY',
      outOfStock: false,
    });
    expect(r.totals.value).toEqual([{ currency: 'TRY', amount: '52.50' }]);
  });

  it('counts sales net of cancellations and returns, ignores other reasons', () => {
    const r = buildStockReport(
      [variant('a', '1')],
      [level('a', 10)],
      [
        { variantId: 'a', reason: 'order', quantity: -6 },
        { variantId: 'a', reason: 'return', quantity: 1 },
        { variantId: 'a', reason: 'transfer_out', quantity: -4 },
        { variantId: 'a', reason: 'purchase', quantity: 20 },
      ],
      30,
      all,
    );
    expect(r.rows[0]).toMatchObject({
      soldUnits: 5,
      turnover: '0.50',
      daysOfCover: 60,
    });
  });

  it('lists out-of-stock variants first', () => {
    const r = buildStockReport(
      [variant('a', '1'), variant('b', '1')],
      [level('a', 4), level('b', 2, 2)],
      [],
      30,
      all,
    );
    expect(r.rows.map((x) => x.variantId)).toEqual(['b', 'a']);
    expect(r.totals.outOfStock).toBe(1);
    expect(r.rows[1]).toMatchObject({ turnover: '0.00', daysOfCover: null });
  });

  it('treats a variant without stock rows as empty', () => {
    const r = buildStockReport([variant('a', '1')], [], [], 30, all);
    expect(r.rows[0]).toMatchObject({
      onHand: 0,
      outOfStock: true,
      turnover: null,
      value: '0.00',
    });
  });

  it('counts missing costs and keeps them out of the value; 0 is a cost', () => {
    const r = buildStockReport(
      [variant('a', null), variant('b', '0')],
      [level('a', 5), level('b', 5)],
      [],
      30,
      all,
    );
    expect(r.totals.missingCost).toBe(1);
    expect(r.totals.value).toEqual([{ currency: 'TRY', amount: '0.00' }]);
  });

  it('hides cost and value of companies whose costs the member may not see', () => {
    const r = buildStockReport(
      [variant('a', '9', 'c1'), variant('b', '9', 'c2')],
      [level('a', 1), level('b', 1)],
      [],
      30,
      (c) => c === 'c1',
    );
    const b = r.rows.find((x) => x.variantId === 'b');
    expect(b).toMatchObject({ unitCost: null, value: null, currency: null });
    expect(r.totals.value).toEqual([{ currency: 'TRY', amount: '9.00' }]);
    expect(r.totals.missingCost).toBe(0);
  });
});
