import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FINAL_STATUSES,
  nextStatuses,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
} from './orders';

/** Parses `TRANSITIONS` out of the backend source so both tables cannot drift apart. */
function backendTable(): Record<string, string[]> {
  const src = readFileSync(
    join(__dirname, '../../../backend/src/orders/order-status.ts'),
    'utf8',
  );
  const body = src.slice(src.indexOf('TRANSITIONS'), src.indexOf('};', src.indexOf('TRANSITIONS')));
  const table: Record<string, string[]> = {};
  for (const m of body.matchAll(/^\s+(\w+): \[([^\]]*)\]/gm)) {
    table[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
  }
  return table;
}

describe('order helpers', () => {
  it('has a Turkish label and a tone for every status', () => {
    for (const s of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABEL[s]).toMatch(/\S/);
      expect(ORDER_STATUS_TONE[s]).toBeDefined();
    }
    expect(new Set(Object.values(ORDER_STATUS_LABEL)).size).toBe(ORDER_STATUSES.length);
  });

  it('uses exactly the backend transition table', () => {
    const backend = backendTable();
    expect(Object.keys(backend).sort()).toEqual([...ORDER_STATUSES].sort());
    for (const s of ORDER_STATUSES) {
      expect({ s, next: [...ORDER_TRANSITIONS[s]] }).toEqual({ s, next: backend[s] });
    }
  });

  it('final statuses have no way out', () => {
    for (const s of FINAL_STATUSES) expect(ORDER_TRANSITIONS[s]).toEqual([]);
  });

  it('offers status changes only for manual orders', () => {
    expect(nextStatuses({ channel: 'manual', status: 'created' })).toContain('picking');
    expect(nextStatuses({ channel: 'trendyol', status: 'created' })).toEqual([]);
  });
});
