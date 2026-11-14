/**
 * Orders in the UI (ORD-03). The status table mirrors backend/src/orders/order-status.ts;
 * orders.test.ts keeps them identical. The backend checks every change again.
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

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting: 'Ödeme bekleniyor',
  created: 'Yeni',
  picking: 'Hazırlanıyor',
  invoiced: 'Faturalandı',
  unpacked: 'Paket bölündü',
  repack: 'Yeniden paketlenecek',
  shipped: 'Kargoda',
  at_collection_point: 'Teslim noktasında',
  delivered: 'Teslim edildi',
  undelivered: 'Teslim edilemedi',
  cancelled: 'İptal edildi',
  unsupplied: 'Tedarik edilemedi',
  returned: 'İade edildi',
};

export type StatusTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export const ORDER_STATUS_TONE: Record<OrderStatus, StatusTone> = {
  awaiting: 'neutral',
  created: 'neutral',
  picking: 'progress',
  invoiced: 'progress',
  unpacked: 'warning',
  repack: 'warning',
  shipped: 'progress',
  at_collection_point: 'progress',
  delivered: 'success',
  undelivered: 'warning',
  cancelled: 'danger',
  unsupplied: 'danger',
  returned: 'danger',
};

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
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

/** Statuses that end an order; changing to them asks for confirmation. */
export const FINAL_STATUSES: readonly OrderStatus[] = ['cancelled', 'unsupplied', 'returned'];

export const MANUAL_CHANNEL = 'manual';

export function channelName(channel: string): string {
  const names: Record<string, string> = {
    manual: 'Elle',
    trendyol: 'Trendyol',
    hepsiburada: 'Hepsiburada',
  };
  return names[channel] ?? channel;
}

/** Next statuses a user may choose; marketplace orders change only through their channel. */
export function nextStatuses(order: { channel: string; status: OrderStatus }): readonly OrderStatus[] {
  return order.channel === MANUAL_CHANNEL ? ORDER_TRANSITIONS[order.status] : [];
}

export const HISTORY_SOURCE_LABEL: Record<string, string> = {
  user: 'Kullanıcı',
  channel: 'Pazaryeri',
  system: 'Sistem',
};

/** "14.11.2026 15:42" in Turkish local time, without seconds. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(iso));
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}
