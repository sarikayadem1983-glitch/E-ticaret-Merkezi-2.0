/**
 * Order status machine (ORD-02). The status names follow the Trendyol shipment package
 * statuses (snake_case); the database CHECK (ORD-01) lists the same values.
 *
 * One table for every source: a marketplace may skip intermediate steps (an order can
 * be reported as shipped without ever being "picking"), so forward skips are allowed;
 * moving backwards is only allowed where the marketplace really does it (repack,
 * undelivered → shipped for a second attempt). Final statuses have no way out.
 */
export const ORDER_STATUSES = [
  'awaiting',
  'created',
  'picking',
  'invoiced',
  'unpacked',
  'repack',
  'shipped',
  'at_collection_point',
  'delivered',
  'undelivered',
  'cancelled',
  'unsupplied',
  'returned',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  awaiting: ['created', 'cancelled'],
  created: ['picking', 'invoiced', 'shipped', 'cancelled', 'unsupplied'],
  picking: ['invoiced', 'unpacked', 'shipped', 'cancelled', 'unsupplied'],
  invoiced: ['unpacked', 'shipped', 'cancelled', 'unsupplied'],
  unpacked: ['repack', 'picking', 'invoiced', 'shipped', 'cancelled'],
  repack: ['picking', 'invoiced', 'shipped', 'cancelled'],
  shipped: ['at_collection_point', 'delivered', 'undelivered', 'returned'],
  at_collection_point: ['delivered', 'undelivered', 'returned'],
  undelivered: ['shipped', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  unsupplied: [],
  returned: [],
};

export const isOrderStatus = (value: string): value is OrderStatus =>
  (ORDER_STATUSES as readonly string[]).includes(value);

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  TRANSITIONS[from].includes(to);

export const isFinal = (status: OrderStatus): boolean =>
  TRANSITIONS[status].length === 0;
