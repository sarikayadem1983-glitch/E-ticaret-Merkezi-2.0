import { Prisma } from '../generated/prisma/client.js';
import {
  buildSalesReport,
  istanbulDay,
  type ReportLine,
  type ReportOrder,
} from './sales-report.js';

const D = (v: string) => new Prisma.Decimal(v);
const order = (id: string, o: Partial<ReportOrder> = {}): ReportOrder => ({
  id,
  channel: 'manual',
  status: 'delivered',
  currency: 'TRY',
  total: D('10.00'),
  orderedAt: new Date('2026-11-14T10:00:00Z'),
  ...o,
});
const line = (
  orderId: string,
  sku: string,
  quantity: number,
  lineTotal: string,
): ReportLine => ({
  orderId,
  sku,
  name: `Ürün ${sku}`,
  quantity,
  lineTotal: D(lineTotal),
});

describe('sales report', () => {
  it('days follow Istanbul time, not UTC', () => {
    expect(istanbulDay(new Date('2026-11-14T21:30:00Z'))).toBe('2026-11-15');
    expect(istanbulDay(new Date('2026-11-14T20:59:59Z'))).toBe('2026-11-14');
  });

  it('adds decimals exactly (no float drift): 0.10 + 0.20 = 0.30', () => {
    const r = buildSalesReport(
      [order('a', { total: D('0.10') }), order('b', { total: D('0.20') })],
      [],
      'channel',
    );
    expect(r.rows).toEqual([
      {
        key: 'manual',
        label: 'manual',
        currency: 'TRY',
        orders: 2,
        quantity: 0,
        revenue: '0.30',
        returned: 0,
      },
    ]);
    expect(r.totals).toEqual([
      { currency: 'TRY', orders: 2, revenue: '0.30', returned: 0 },
    ]);
  });

  it('groups by day in date order, keeps currencies apart, counts returns separately', () => {
    const orders = [
      order('a', {
        orderedAt: new Date('2026-11-13T09:00:00Z'),
        total: D('100.00'),
      }),
      order('b', {
        orderedAt: new Date('2026-11-14T09:00:00Z'),
        total: D('50.50'),
      }),
      order('c', {
        orderedAt: new Date('2026-11-14T09:00:00Z'),
        total: D('20.00'),
        currency: 'EUR',
      }),
      order('d', {
        orderedAt: new Date('2026-11-14T09:00:00Z'),
        total: D('70.00'),
        status: 'returned',
      }),
    ];
    const r = buildSalesReport(
      orders,
      [line('a', 'X', 2, '100.00'), line('b', 'X', 1, '50.50')],
      'day',
    );
    expect(
      r.rows.map((x) => [
        x.key,
        x.currency,
        x.orders,
        x.quantity,
        x.revenue,
        x.returned,
      ]),
    ).toEqual([
      ['2026-11-13', 'TRY', 1, 2, '100.00', 0],
      ['2026-11-14', 'EUR', 1, 0, '20.00', 0],
      ['2026-11-14', 'TRY', 1, 1, '50.50', 1],
    ]);
    expect(r.totals).toEqual([
      { currency: 'EUR', orders: 1, revenue: '20.00', returned: 0 },
      { currency: 'TRY', orders: 2, revenue: '150.50', returned: 1 },
    ]);
  });

  it('groups by product with line totals, highest revenue first', () => {
    const r = buildSalesReport(
      [order('a'), order('b'), order('r', { status: 'returned' })],
      [
        line('a', 'X', 2, '20.00'),
        line('a', 'Y', 1, '99.90'),
        line('b', 'X', 3, '30.00'),
        line('r', 'X', 1, '10.00'),
      ],
      'product',
    );
    expect(
      r.rows.map((x) => [x.key, x.orders, x.quantity, x.revenue, x.returned]),
    ).toEqual([
      ['Y', 1, 1, '99.90', 0],
      ['X', 2, 5, '50.00', 1],
    ]);
  });

  it('ignores lines of orders outside the report', () => {
    const r = buildSalesReport(
      [order('a')],
      [line('zz', 'X', 9, '9.00')],
      'product',
    );
    expect(r.rows).toEqual([]);
  });
});
