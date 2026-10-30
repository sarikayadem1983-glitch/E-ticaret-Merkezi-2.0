import { createsCycle } from './category-tree.js';

/** Parent lookup over an in-memory tree: child → parent. */
const tree = (edges: Record<string, string | null>) => async (id: string) =>
  id in edges ? edges[id] : undefined;

describe('createsCycle', () => {
  const parents = tree({ a: null, b: 'a', c: 'b', d: null });

  it('detects self, direct (A→B→A) and deep cycles', async () => {
    await expect(createsCycle('a', 'a', parents)).resolves.toBe(true);
    await expect(createsCycle('a', 'b', parents)).resolves.toBe(true);
    await expect(createsCycle('a', 'c', parents)).resolves.toBe(true);
  });

  it('allows moving under an unrelated node or to the root', async () => {
    await expect(createsCycle('c', 'd', parents)).resolves.toBe(false);
    await expect(createsCycle('b', null, parents)).resolves.toBe(false);
    await expect(createsCycle('d', 'c', parents)).resolves.toBe(false);
  });

  it('stops on an existing cycle instead of looping forever', async () => {
    const broken = tree({ x: 'y', y: 'x', z: null });
    await expect(createsCycle('z', 'x', broken)).resolves.toBe(true);
  });
});
