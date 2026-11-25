/** Deepest allowed nesting: a root is depth 1. Bounds every tree walk. */
export const MAX_CATEGORY_DEPTH = 3

export type TreeRow = { id: string; parentId: string | null }

export type ParentProblem =
  "MISSING_PARENT" | "SELF_PARENT" | "CYCLE" | "TOO_DEEP"

/** Depth of a category: 1 for a root. Stops at a cycle in corrupt data. */
export function depthOf(id: string, parentOf: Map<string, string | null>) {
  let depth = 1
  let current = parentOf.get(id) ?? null
  const seen = new Set<string>([id])

  while (current !== null) {
    if (seen.has(current)) return Number.POSITIVE_INFINITY

    seen.add(current)
    depth += 1
    current = parentOf.get(current) ?? null
  }

  return depth
}

/** Levels below `id` (0 for a leaf), over `rows`. */
export function heightOf(id: string, rows: readonly TreeRow[]): number {
  const children = new Map<string, string[]>()

  for (const row of rows) {
    if (row.parentId === null) continue

    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id])
  }

  const walk = (node: string, seen: Set<string>): number => {
    let tallest = 0

    for (const child of children.get(node) ?? []) {
      if (seen.has(child)) return Number.POSITIVE_INFINITY

      tallest = Math.max(tallest, 1 + walk(child, new Set([...seen, child])))
    }

    return tallest
  }

  return walk(id, new Set([id]))
}

/**
 * Why `parentId` cannot be the parent of `id` (or of a new category when `id`
 * is `null`), or `null` when it can. `rows` is every category as it is now.
 *
 * - the parent must exist;
 * - a category cannot be its own parent, nor a descendant of itself, which
 *   would turn the tree into a loop;
 * - the result, counting the moved subtree, must fit `MAX_CATEGORY_DEPTH`.
 */
export function parentProblem(
  rows: readonly TreeRow[],
  id: string | null,
  parentId: string | null
): ParentProblem | null {
  if (parentId === null) return null

  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]))

  if (!parentOf.has(parentId)) return "MISSING_PARENT"
  if (id !== null && id === parentId) return "SELF_PARENT"

  if (id !== null) {
    // Walk up from the proposed parent: meeting `id` means `id` is above it.
    const seen = new Set<string>()
    let current: string | null = parentId

    while (current !== null && !seen.has(current)) {
      if (current === id) return "CYCLE"

      seen.add(current)
      current = parentOf.get(current) ?? null
    }
  }

  const subtree = id === null ? 0 : heightOf(id, rows)
  const total = depthOf(parentId, parentOf) + 1 + subtree

  return total > MAX_CATEGORY_DEPTH ? "TOO_DEEP" : null
}

export type CategoryNode<T extends TreeRow> = T & {
  children: CategoryNode<T>[]
}

/**
 * Nests flat rows into a forest, siblings in the order given. A row whose
 * parent is not in `rows` is treated as a root rather than dropped.
 */
export function buildCategoryTree<T extends TreeRow>(
  rows: readonly T[]
): CategoryNode<T>[] {
  const nodes = new Map<string, CategoryNode<T>>(
    rows.map((row) => [row.id, { ...row, children: [] }])
  )
  const roots: CategoryNode<T>[] = []

  for (const row of rows) {
    const node = nodes.get(row.id)!
    const parent = row.parentId === null ? undefined : nodes.get(row.parentId)

    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  return roots
}
