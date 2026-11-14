import { Prisma } from '../generated/prisma/client.js';

/**
 * Sales report math (RPT-01), kept pure so it is unit-tested without a database.
 * Amounts are Prisma.Decimal end to end and returned as fixed 2-digit strings.
 */

/** Orders that never turned into a sale are left out. Returns are counted separately. */
export const EXCLUDED_STATUSES = ['cancelled', 'unsupplied'] as const;

export type GroupBy = 'day' | 'channel' | 'product';

export interface ReportOrder {
  id: string;
  channel: string;
  status: string;
  currency: string;
  total: Prisma.Decimal;
  orderedAt: Date;
}

export interface ReportLine {
  orderId: string;
  sku: string;
  name: string;
  quantity: number;
  lineTotal: Prisma.Decimal;
}

export interface ReportRow {
  key: string;
  label: string;
  currency: string;
  orders: number;
  quantity: number;
  revenue: string;
  returned: number;
}

const ZERO = new Prisma.Decimal(0);
const fixed = (d: Prisma.Decimal) => d.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

/** "2026-11-14" in Europe/Istanbul (orders are dated in Turkish local time). */
export function istanbulDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

interface Acc {
  key: string;
  label: string;
  currency: string;
  orders: Set<string>;
  quantity: number;
  revenue: Prisma.Decimal;
  returned: Set<string>;
}

/**
 * Groups orders (day, channel) or order lines (product) per currency: amounts in
 * different currencies are never added together. Revenue is the order total for day and
 * channel, the line total for product. Returned orders count in `returned` and are not
 * revenue.
 */
export function buildSalesReport(
  orders: ReportOrder[],
  lines: ReportLine[],
  groupBy: GroupBy,
): {
  rows: ReportRow[];
  totals: {
    currency: string;
    orders: number;
    revenue: string;
    returned: number;
  }[];
} {
  const acc = new Map<string, Acc>();
  const bucket = (key: string, label: string, currency: string) => {
    const k = `${currency}|${key}`;
    let a = acc.get(k);
    if (!a) {
      a = {
        key,
        label,
        currency,
        orders: new Set(),
        quantity: 0,
        revenue: ZERO,
        returned: new Set(),
      };
      acc.set(k, a);
    }
    return a;
  };
  const byId = new Map(orders.map((o) => [o.id, o]));

  if (groupBy === 'product') {
    for (const l of lines) {
      const o = byId.get(l.orderId);
      if (!o) continue;
      const a = bucket(l.sku, l.name, o.currency);
      if (o.status === 'returned') {
        a.returned.add(o.id);
        continue;
      }
      a.orders.add(o.id);
      a.quantity += l.quantity;
      a.revenue = a.revenue.plus(l.lineTotal);
    }
  } else {
    const qty = new Map<string, number>();
    for (const l of lines)
      qty.set(l.orderId, (qty.get(l.orderId) ?? 0) + l.quantity);
    for (const o of orders) {
      const key = groupBy === 'day' ? istanbulDay(o.orderedAt) : o.channel;
      const a = bucket(key, key, o.currency);
      if (o.status === 'returned') {
        a.returned.add(o.id);
        continue;
      }
      a.orders.add(o.id);
      a.quantity += qty.get(o.id) ?? 0;
      a.revenue = a.revenue.plus(o.total);
    }
  }

  const rows = [...acc.values()]
    .map((a) => ({
      key: a.key,
      label: a.label,
      currency: a.currency,
      orders: a.orders.size,
      quantity: a.quantity,
      revenue: fixed(a.revenue),
      returned: a.returned.size,
    }))
    .sort((x, y) =>
      groupBy === 'day'
        ? x.key.localeCompare(y.key) || x.currency.localeCompare(y.currency)
        : new Prisma.Decimal(y.revenue).comparedTo(x.revenue) ||
          x.key.localeCompare(y.key),
    );

  const totals = new Map<
    string,
    { orders: number; revenue: Prisma.Decimal; returned: number }
  >();
  for (const o of orders) {
    const t = totals.get(o.currency) ?? {
      orders: 0,
      revenue: ZERO,
      returned: 0,
    };
    if (o.status === 'returned') t.returned += 1;
    else {
      t.orders += 1;
      t.revenue = t.revenue.plus(o.total);
    }
    totals.set(o.currency, t);
  }
  return {
    rows,
    totals: [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, t]) => ({
        currency,
        orders: t.orders,
        revenue: fixed(t.revenue),
        returned: t.returned,
      })),
  };
}
