/** Parent of a category: `null` at the root, `undefined` when the row is missing. */
export type ParentLookup = (id: string) => Promise<string | null | undefined>;

/** Upper bound on the walk; the tree is never this deep in practice. */
const MAX_DEPTH = 1000;

/**
 * True when putting `id` under `newParentId` would make a cycle: the new parent
 * is the category itself or one of its descendants. An existing cycle or an
 * over-deep chain is also reported as a cycle (fail closed).
 */
export async function createsCycle(
  id: string,
  newParentId: string | null,
  parentOf: ParentLookup,
): Promise<boolean> {
  const seen = new Set<string>();
  let current: string | null | undefined = newParentId;
  while (current) {
    if (current === id || seen.has(current) || seen.size >= MAX_DEPTH) {
      return true;
    }
    seen.add(current);
    current = await parentOf(current);
  }
  return false;
}
