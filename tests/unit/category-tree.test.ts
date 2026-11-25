import { describe, expect, it } from "vitest"
import {
  MAX_CATEGORY_DEPTH,
  buildCategoryTree,
  depthOf,
  heightOf,
  parentProblem,
} from "@/lib/categories/tree"

type Row = { id: string; parentId: string | null }

// a ── b ── c        d        (c is at depth 3, the deepest allowed)
const chain: Row[] = [
  { id: "a", parentId: null },
  { id: "b", parentId: "a" },
  { id: "c", parentId: "b" },
  { id: "d", parentId: null },
]

describe("parentProblem", () => {
  it("TC-E9S2-03: a category cannot be its own parent", () => {
    expect(parentProblem(chain, "a", "a")).toBe("SELF_PARENT")
  })

  it("TC-E9S2-03: a category cannot go under its own child or deeper descendant", () => {
    expect(parentProblem(chain, "a", "b")).toBe("CYCLE")
    expect(parentProblem(chain, "a", "c")).toBe("CYCLE")
    expect(parentProblem(chain, "b", "c")).toBe("CYCLE")
  })

  it("allows moves that make no loop", () => {
    expect(parentProblem(chain, "c", "d")).toBeNull()
    expect(parentProblem(chain, "c", null)).toBeNull()
    expect(parentProblem(chain, "d", "a")).toBeNull()
    expect(parentProblem(chain, "b", "d")).toBeNull()
  })

  it("a missing parent is reported", () => {
    expect(parentProblem(chain, "a", "nope")).toBe("MISSING_PARENT")
    expect(parentProblem(chain, null, "nope")).toBe("MISSING_PARENT")
  })

  it("a new category (no id) can go anywhere that has room", () => {
    expect(parentProblem(chain, null, null)).toBeNull()
    expect(parentProblem(chain, null, "a")).toBeNull()
    expect(parentProblem(chain, null, "b")).toBeNull()
    expect(parentProblem(chain, null, "c")).toBe("TOO_DEEP")
  })

  it(`nesting is limited to ${MAX_CATEGORY_DEPTH} levels, counting the moved subtree`, () => {
    // d has no children: it can go under b (depth 3) but not under c (depth 4).
    expect(parentProblem(chain, "d", "b")).toBeNull()
    expect(parentProblem(chain, "d", "c")).toBe("TOO_DEEP")

    // a has a subtree two levels tall: it cannot go under d (1 + 1 + 2 = 4).
    expect(parentProblem(chain, "a", "d")).toBe("TOO_DEEP")
    // b has a subtree one level tall: under d is 1 + 1 + 1 = 3, fine.
    expect(parentProblem(chain, "b", "d")).toBeNull()
  })

  it("does not hang on corrupt data that already contains a loop", () => {
    const loop: Row[] = [
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
      { id: "z", parentId: null },
    ]

    expect(parentProblem(loop, "z", "x")).toBe("TOO_DEEP")
    expect(depthOf("x", new Map(loop.map((r) => [r.id, r.parentId])))).toBe(
      Number.POSITIVE_INFINITY
    )
    expect(heightOf("x", loop)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe("depthOf and heightOf", () => {
  const parentOf = new Map(chain.map((r) => [r.id, r.parentId]))

  it("counts levels from the root", () => {
    expect(depthOf("a", parentOf)).toBe(1)
    expect(depthOf("b", parentOf)).toBe(2)
    expect(depthOf("c", parentOf)).toBe(3)
    expect(depthOf("d", parentOf)).toBe(1)
  })

  it("counts levels below a category", () => {
    expect(heightOf("a", chain)).toBe(2)
    expect(heightOf("b", chain)).toBe(1)
    expect(heightOf("c", chain)).toBe(0)
    expect(heightOf("d", chain)).toBe(0)
  })
})

describe("buildCategoryTree", () => {
  it("nests rows under their parents, keeping the given order", () => {
    const tree = buildCategoryTree([
      { id: "tours", parentId: null, name: "Tours" },
      { id: "walks", parentId: "tours", name: "Walks" },
      { id: "food", parentId: "tours", name: "Food" },
      { id: "events", parentId: null, name: "Events" },
    ])

    expect(tree.map((n) => n.id)).toEqual(["tours", "events"])
    expect(tree[0]?.children.map((n) => n.id)).toEqual(["walks", "food"])
    expect(tree[0]?.children[0]?.name).toBe("Walks")
    expect(tree[1]?.children).toEqual([])
  })

  it("treats a row whose parent is absent as a root instead of dropping it", () => {
    const tree = buildCategoryTree([{ id: "x", parentId: "gone" }])

    expect(tree.map((n) => n.id)).toEqual(["x"])
  })

  it("is empty for no rows", () => {
    expect(buildCategoryTree([])).toEqual([])
  })
})
