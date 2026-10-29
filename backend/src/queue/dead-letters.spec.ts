import { scanFailed } from './dead-letters.js';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Fake failed set: index i belongs to `owner(i)`. Records every page read. */
function failedSet(size: number, owner: (i: number) => string) {
  const reads: [number, number][] = [];
  const jobs = Array.from({ length: size }, (_, i) => ({
    id: String(i),
    data: { tenantId: owner(i), payload: { i } },
    attemptsMade: 1,
    failedReason: 'JOB_FAILED:Error',
    finishedOn: 1,
  }));
  const getFailed = async (start: number, end: number) => {
    reads.push([start, end]);
    return jobs.slice(start, end + 1);
  };
  return { getFailed, reads };
}

const opts = { batchSize: 100, maxScan: 500 };

describe('scanFailed', () => {
  it("another tenant's mass failures do not change the result", async () => {
    const { getFailed } = failedSet(300, (i) => (i % 100 === 0 ? B : A));
    const page = await scanFailed(getFailed, B, { limit: 10 }, opts);
    expect(page.items.map((j) => j.id)).toEqual(['0', '100', '200']);
    expect(page.nextCursor).toBeUndefined();
  });

  it('stops after maxScan jobs and returns a cursor to continue', async () => {
    const { getFailed, reads } = failedSet(5000, (i) => (i === 4000 ? B : A));
    const first = await scanFailed(getFailed, B, { limit: 10 }, opts);
    expect(first.items).toEqual([]);
    expect(first.nextCursor).toBe(500);
    const scanned = reads.reduce((n, [s, e]) => n + (e - s + 1), 0);
    expect(scanned).toBeLessThanOrEqual(500);

    let cursor = first.nextCursor;
    const found: string[] = [];
    let calls = 0;
    while (cursor !== undefined) {
      const page = await scanFailed(getFailed, B, { limit: 10, cursor }, opts);
      found.push(...page.items.map((j) => j.id));
      cursor = page.nextCursor;
      calls++;
    }
    expect(found).toEqual(['4000']);
    // 500..4500 in steps of 500, plus one empty read at the end.
    expect(calls).toBe(10);
  });

  it('stops at limit and resumes right after the last returned job', async () => {
    const { getFailed } = failedSet(50, () => A);
    const first = await scanFailed(getFailed, A, { limit: 20 }, opts);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBe(20);
    const second = await scanFailed(
      getFailed,
      A,
      { limit: 20, cursor: first.nextCursor },
      opts,
    );
    expect(second.items[0].id).toBe('20');
  });

  it('clamps limit and returns only the code, never the stack', async () => {
    const { getFailed } = failedSet(3, () => A);
    const page = await scanFailed(getFailed, A, { limit: 10_000 }, opts);
    expect(page.items[0]).toEqual({
      id: '0',
      tenantId: A,
      payload: { i: 0 },
      attemptsMade: 1,
      errorCode: 'JOB_FAILED:Error',
      failedAt: new Date(1),
    });
  });
});
