import { Prisma } from '../generated/prisma/client.js';

/**
 * Stock report math (RPT-02), kept pure so it is unit-tested without a database.
 * Per variant, summed over warehouses: on hand, available, units sold in the period,
 * turnover, days of cover and (only when the cost may be shown) stock value at the
 * current purchase cost. Value is VAT excluded; it is not FIFO or weighted average.
 */

export interface StockLevelInput {
  variantId: string;
  onHand: number;
  reserved: number;
}

export interface MovementInput {
  variantId: string;
  reason: string;
  /** Sum of signed quantities of this reason in the period. */
  quantity: number;
}

export interface VariantInput {
  id: string;
  companyId: string;
  sku: string;
  name: string;
  purchaseCost: Prisma.Decimal | null;
  costCurrency: string | null;
}

export interface StockReportRow {
  variantId: string;
  companyId: string;
  sku: string;
  name: string;
  onHand: number;
  available: number;
  soldUnits: number;
  /** Sold units / units on hand; null when nothing is on hand. */
  turnover: string | null;
  /** On hand / average daily sales; null when nothing was sold. */
  daysOfCover: number | null;
  outOfStock: boolean;
  /** Null when the cost is not entered or the member may not see costs. */
  unitCost: string | null;
  value: string | null;
  currency: string | null;
}

export interface StockReport {
  rows: StockReportRow[];
  totals: {
    variants: number;
    outOfStock: number;
    onHand: number;
    soldUnits: number;
    /** Value per currency; visible variants without a cost are counted in `missingCost`. */
    value: { currency: string; amount: string }[];
    missingCost: number;
  };
}

/** Sales lower stock with reason `order`; cancellations and returns give it back. */
export const SALE_REASONS = ['order', 'order_cancel', 'return'] as const;
const SALE = new Set<string>(SALE_REASONS);
const fixed = (d: Prisma.Decimal) =>
  d.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

export function buildStockReport(
  variants: VariantInput[],
  levels: StockLevelInput[],
  movements: MovementInput[],
  days: number,
  costVisible: (companyId: string) => boolean,
): StockReport {
  const stock = new Map<string, { onHand: number; reserved: number }>();
  for (const l of levels) {
    const s = stock.get(l.variantId) ?? { onHand: 0, reserved: 0 };
    s.onHand += l.onHand;
    s.reserved += l.reserved;
    stock.set(l.variantId, s);
  }
  const sold = new Map<string, number>();
  for (const m of movements) {
    if (!SALE.has(m.reason)) continue;
    sold.set(m.variantId, (sold.get(m.variantId) ?? 0) - m.quantity);
  }

  const values = new Map<string, Prisma.Decimal>();
  let missingCost = 0;
  const rows = variants.map((v): StockReportRow => {
    const s = stock.get(v.id) ?? { onHand: 0, reserved: 0 };
    const soldUnits = Math.max(0, sold.get(v.id) ?? 0);
    const available = Math.max(0, s.onHand - s.reserved);
    const visible = costVisible(v.companyId);
    const cost = visible ? v.purchaseCost : null;
    const currency = cost ? (v.costCurrency ?? 'TRY') : null;
    let value: Prisma.Decimal | null = null;
    if (cost && currency) {
      value = cost.mul(s.onHand);
      values.set(
        currency,
        (values.get(currency) ?? new Prisma.Decimal(0)).add(value),
      );
    } else if (visible) {
      missingCost += 1;
    }
    return {
      variantId: v.id,
      companyId: v.companyId,
      sku: v.sku,
      name: v.name,
      onHand: s.onHand,
      available,
      soldUnits,
      turnover:
        s.onHand > 0
          ? new Prisma.Decimal(soldUnits).div(s.onHand).toFixed(2)
          : null,
      daysOfCover:
        soldUnits > 0 ? Math.floor((s.onHand * days) / soldUnits) : null,
      outOfStock: available === 0,
      unitCost: cost ? fixed(cost) : null,
      value: value ? fixed(value) : null,
      currency,
    };
  });
  rows.sort(
    (a, b) =>
      Number(b.outOfStock) - Number(a.outOfStock) || a.sku.localeCompare(b.sku),
  );

  return {
    rows,
    totals: {
      variants: rows.length,
      outOfStock: rows.filter((r) => r.outOfStock).length,
      onHand: rows.reduce((n, r) => n + r.onHand, 0),
      soldUnits: rows.reduce((n, r) => n + r.soldUnits, 0),
      value: [...values]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, d]) => ({ currency, amount: fixed(d) })),
      missingCost,
    },
  };
}
