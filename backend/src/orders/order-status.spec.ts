import {
  canTransition,
  isFinal,
  ORDER_STATUSES,
  type OrderStatus,
  TRANSITIONS,
} from './order-status.js';

/**
 * The full 13 × 13 table, written out independently of TRANSITIONS: every cell is
 * checked, so a change to the machine must change this table too (ORD-02 acceptance).
 * Columns in ORDER_STATUSES order; 1 = allowed.
 */
// prettier-ignore
const EXPECTED: Record<OrderStatus, string> = {
  //                   aw cr pi in un re sh ac de ud ca us rt
  awaiting:            '0  1  0  0  0  0  0  0  0  0  1  0  0',
  created:             '0  0  1  1  0  0  1  0  0  0  1  1  0',
  picking:             '0  0  0  1  1  0  1  0  0  0  1  1  0',
  invoiced:            '0  0  0  0  1  0  1  0  0  0  1  1  0',
  unpacked:            '0  0  1  1  0  1  1  0  0  0  1  0  0',
  repack:              '0  0  1  1  0  0  1  0  0  0  1  0  0',
  shipped:             '0  0  0  0  0  0  0  1  1  1  0  0  1',
  at_collection_point: '0  0  0  0  0  0  0  0  1  1  0  0  1',
  delivered:           '0  0  0  0  0  0  0  0  0  0  0  0  1',
  undelivered:         '0  0  0  0  0  0  1  0  0  0  0  0  1',
  cancelled:           '0  0  0  0  0  0  0  0  0  0  0  0  0',
  unsupplied:          '0  0  0  0  0  0  0  0  0  0  0  0  0',
  returned:            '0  0  0  0  0  0  0  0  0  0  0  0  0',
};

const cells = ORDER_STATUSES.flatMap((from) => {
  const row = EXPECTED[from].split(/\s+/);
  return ORDER_STATUSES.map((to, i) => [from, to, row[i] === '1'] as const);
});

describe('order status machine', () => {
  it('the expected table covers every status', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ORDER_STATUSES].sort());
    for (const s of ORDER_STATUSES) {
      expect(EXPECTED[s].split(/\s+/)).toHaveLength(ORDER_STATUSES.length);
    }
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
  });

  it.each(cells)('%s → %s allowed=%s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });

  it('never allows staying in the same status', () => {
    for (const s of ORDER_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it('final statuses are exactly cancelled, unsupplied and returned', () => {
    expect(ORDER_STATUSES.filter(isFinal)).toEqual([
      'cancelled',
      'unsupplied',
      'returned',
    ]);
  });

  it('every non-final status can still reach a final one', () => {
    for (const start of ORDER_STATUSES) {
      const seen = new Set<OrderStatus>([start]);
      const queue: OrderStatus[] = [start];
      while (queue.length) {
        for (const next of TRANSITIONS[queue.shift()!]) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect([...seen].some(isFinal)).toBe(true);
    }
  });
});
