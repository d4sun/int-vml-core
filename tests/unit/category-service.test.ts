import { describe, expect, it } from "vitest"
import type { SessionSource } from "@/lib/auth/guards"
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors"
import {
  createCategory,
  deleteCategory,
  getCategoryTree,
  updateCategory,
} from "@/lib/services/category"

type Cat = {
  id: string
  name: string
  slug: string
  parentId: string | null
  type: "TIMED_SLOT"
  commissionBpsDefault: number
}

const cat = (
  id: string,
  parentId: string | null = null,
  over: Partial<Cat> = {}
): Cat => ({
  id,
  name: id.toUpperCase(),
  slug: id,
  parentId,
  type: "TIMED_SLOT",
  commissionBpsDefault: 1000,
  ...over,
})

const as =
  (platformRole: string | null): SessionSource =>
  async () =>
    platformRole
      ? {
          user: {
            id: "admin-1",
            email: "a@example.com",
            name: "A",
            emailVerified: true,
            platformRole,
          },
        }
      : null

function setup(
  initial: Cat[] = [],
  options: { listings?: Record<string, number> } = {}
) {
  const rows = [...initial]
  const log: string[] = []
  const audits: {
    action: string
    entityId: string
    meta: unknown
    actorId: string | null
  }[] = []
  let next = 0

  const tx = {
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      log.push(`lock:${strings.join("?")}:${values.join(",")}`)

      return 0
    },
    category: {
      findMany: async () => {
        log.push("read")

        return rows.map((r) => ({
          ...r,
          _count: { listings: options.listings?.[r.id] ?? 0 },
        }))
      },
      findUnique: async (args: { where: { id: string } }) =>
        rows.find((r) => r.id === args.where.id) ?? null,
      count: async (args: { where: { parentId: string } }) =>
        rows.filter((r) => r.parentId === args.where.parentId).length,
      create: async (args: { data: Omit<Cat, "id"> }) => {
        log.push("create")
        next += 1
        const row = { id: `new-${next}`, ...args.data }
        rows.push(row)

        return row
      },
      update: async (args: { where: { id: string }; data: Partial<Cat> }) => {
        log.push("update")
        const row = rows.find((r) => r.id === args.where.id)!
        Object.assign(row, args.data)

        return row
      },
      delete: async (args: { where: { id: string } }) => {
        log.push("delete")
        rows.splice(
          rows.findIndex((r) => r.id === args.where.id),
          1
        )
      },
    },
    listing: {
      count: async (args: { where: { categoryId: string } }) =>
        options.listings?.[args.where.categoryId] ?? 0,
    },
  }

  const db = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    category: tx.category,
  } as never

  const record = (async (
    _tx: unknown,
    entry: {
      action: string
      entityId: string
      meta: unknown
      actorId: string | null
    }
  ) => {
    log.push(`audit:${entry.action}`)
    audits.push(entry)

    return "audit-1"
  }) as never

  return { rows, log, audits, deps: { session: as("ADMIN"), db, record } }
}

const untouched = {
  $transaction: async () => {
    throw new Error("the database must not be reached")
  },
  category: {},
} as never

describe("category service access (CR-1)", () => {
  it.each([
    ["create", (d: object) => createCategory({ name: "X" }, d)],
    ["update", (d: object) => updateCategory({ id: "a", name: "X" }, d)],
    ["delete", (d: object) => deleteCategory({ id: "a" }, d)],
    ["tree", (d: object) => getCategoryTree(d)],
  ])("%s: a non-admin is refused before anything else", async (_, call) => {
    for (const role of ["TOURIST", "VENDOR"]) {
      await expect(
        call({ session: as(role), db: untouched })
      ).rejects.toBeInstanceOf(ForbiddenError)
    }
  })

  it.each([
    ["create", (d: object) => createCategory({ name: "X" }, d)],
    ["update", (d: object) => updateCategory({ id: "a", name: "X" }, d)],
    ["delete", (d: object) => deleteCategory({ id: "a" }, d)],
    ["tree", (d: object) => getCategoryTree(d)],
  ])("%s: signed out is a 401", async (_, call) => {
    await expect(
      call({ session: as(null), db: untouched })
    ).rejects.toMatchObject({
      status: 401,
    })
  })

  it("a non-admin learns nothing about the input", async () => {
    await expect(
      createCategory(
        { nonsense: true },
        { session: as("VENDOR"), db: untouched }
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("invalid input from an admin is a ValidationError before the database", async () => {
    await expect(
      createCategory({ name: "" }, { session: as("ADMIN"), db: untouched })
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("createCategory", () => {
  it("takes the tree lock, then reads, creates and audits, in that order", async () => {
    const t = setup()
    const created = await createCategory(
      { name: "Food & Drink", commissionBpsDefault: 1500 },
      t.deps
    )

    expect(created).toMatchObject({
      name: "Food & Drink",
      slug: "food-drink",
      parentId: null,
      type: "TIMED_SLOT",
      commissionBpsDefault: 1500,
    })
    expect(t.log.map((l) => l.split(":")[0])).toEqual([
      "lock",
      "read",
      "create",
      "audit",
    ])
    expect(t.log[0]).toContain("pg_advisory_xact_lock")
    expect(t.audits).toEqual([
      {
        actorId: "admin-1",
        action: "category.created",
        entityType: "Category",
        entityId: created.id,
        meta: {
          name: "Food & Drink",
          slug: "food-drink",
          parentId: null,
          commissionBpsDefault: 1500,
        },
      },
    ])
  })

  it("uses a slug the admin gives, and the default commission of 10%", async () => {
    const t = setup()
    const created = await createCategory(
      { name: "Walks", slug: "walking-tours" },
      t.deps
    )

    expect(created.slug).toBe("walking-tours")
    expect(created.commissionBpsDefault).toBe(1000)
  })

  it("a slug already in use is a Conflict reported on the slug field, with nothing written", async () => {
    const t = setup([cat("tours")])
    const error = await createCategory({ name: "Tours" }, t.deps).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).fieldErrors).toHaveProperty("slug")
    expect(t.log).not.toContain("create")
    expect(t.audits).toEqual([])
  })

  it("a generated slug that is a page of the site is refused on the slug field", async () => {
    const t = setup()
    const error = await createCategory({ name: "Admin" }, t.deps).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).fieldErrors).toHaveProperty("slug")
    expect(t.log).not.toContain("create")
  })

  it("a name with no letters or numbers needs an explicit slug", async () => {
    const t = setup()
    const error = await createCategory({ name: "🙂" }, t.deps).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).fieldErrors).toHaveProperty("slug")
    expect(
      (await createCategory({ name: "🙂", slug: "fun" }, t.deps)).slug
    ).toBe("fun")
  })

  it("a missing parent and a parent with no room are ValidationErrors on parentId", async () => {
    const deep = [cat("a"), cat("b", "a"), cat("c", "b")]

    for (const parentId of ["nope", "c"]) {
      const t = setup(deep)
      const error = await createCategory({ name: "X", parentId }, t.deps).catch(
        (e: unknown) => e
      )

      expect(error, parentId).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).fieldErrors).toHaveProperty("parentId")
      expect(t.log).not.toContain("create")
    }
  })

  it("can create under an existing parent", async () => {
    const t = setup([cat("tours")])

    expect(
      (await createCategory({ name: "Walks", parentId: "tours" }, t.deps))
        .parentId
    ).toBe("tours")
  })
})

describe("updateCategory", () => {
  it("TC-E9S2-03: a move that would make a loop is refused and nothing is written", async () => {
    const t = setup([cat("a"), cat("b", "a")])
    const error = await updateCategory(
      { id: "a", parentId: "b" },
      t.deps
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).fieldErrors?.parentId?.[0]).toContain(
      "sub-categories"
    )
    expect(t.log).not.toContain("update")
    expect(t.audits).toEqual([])
  })

  it("a category cannot be its own parent", async () => {
    const t = setup([cat("a")])

    await expect(
      updateCategory({ id: "a", parentId: "a" }, t.deps)
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("moves a category, including to the top level, and audits what changed", async () => {
    const t = setup([cat("a"), cat("b"), cat("c", "a")])

    await updateCategory({ id: "c", parentId: "b" }, t.deps)
    expect(t.rows.find((r) => r.id === "c")?.parentId).toBe("b")

    await updateCategory({ id: "c", parentId: null }, t.deps)
    expect(t.rows.find((r) => r.id === "c")?.parentId).toBeNull()
    expect(t.audits.map((a) => a.meta)).toEqual([
      { changes: { parentId: { from: "a", to: "b" } } },
      { changes: { parentId: { from: "b", to: null } } },
    ])
  })

  it("TC-E9S2-02: a commission change is audited with both values and touches nothing else", async () => {
    const t = setup([cat("a", null, { commissionBpsDefault: 1000 })])
    const updated = await updateCategory(
      { id: "a", commissionBpsDefault: 1500 },
      t.deps
    )

    expect(updated.commissionBpsDefault).toBe(1500)
    expect(t.audits[0]).toMatchObject({
      action: "category.updated",
      entityId: "a",
      actorId: "admin-1",
      meta: { changes: { commissionBpsDefault: { from: 1000, to: 1500 } } },
    })
  })

  it("a no-op update writes nothing and records nothing", async () => {
    const t = setup([cat("a", null, { commissionBpsDefault: 1000 })])

    await updateCategory(
      { id: "a", name: "A", commissionBpsDefault: 1000 },
      t.deps
    )

    expect(t.log).not.toContain("update")
    expect(t.audits).toEqual([])
  })

  it("renaming to a slug another category uses is a Conflict; keeping its own slug is not", async () => {
    const t = setup([cat("a"), cat("b")])

    await expect(
      updateCategory({ id: "a", slug: "b" }, t.deps)
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      updateCategory({ id: "a", slug: "a", name: "New" }, t.deps)
    ).resolves.toMatchObject({ name: "New" })
  })

  it("an unknown category is NotFound", async () => {
    await expect(
      updateCategory({ id: "nope", name: "X" }, setup().deps)
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("a move that makes the tree too deep is refused", async () => {
    const t = setup([cat("a"), cat("b", "a"), cat("c", "b"), cat("d")])

    await expect(
      updateCategory({ id: "d", parentId: "c" }, t.deps)
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("deleteCategory", () => {
  it("TC-E9S2-01: a category with listings cannot be deleted", async () => {
    const t = setup([cat("a")], { listings: { a: 2 } })
    const error = await deleteCategory({ id: "a" }, t.deps).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toEqual({
      reason: "HAS_LISTINGS",
      listings: 2,
    })
    expect(t.rows).toHaveLength(1)
    expect(t.audits).toEqual([])
  })

  it("a category with sub-categories cannot be deleted", async () => {
    const t = setup([cat("a"), cat("b", "a")])
    const error = await deleteCategory({ id: "a" }, t.deps).catch(
      (e: unknown) => e
    )

    expect((error as ConflictError).details).toEqual({
      reason: "HAS_CHILDREN",
      children: 1,
    })
    expect(t.rows).toHaveLength(2)
  })

  it("an empty leaf is deleted and audited with a snapshot", async () => {
    const t = setup([cat("a"), cat("b", "a", { commissionBpsDefault: 750 })])

    await deleteCategory({ id: "b" }, t.deps)

    expect(t.rows.map((r) => r.id)).toEqual(["a"])
    expect(t.audits[0]).toMatchObject({
      action: "category.deleted",
      entityId: "b",
      meta: { name: "B", slug: "b", parentId: "a", commissionBpsDefault: 750 },
    })
  })

  it("an unknown category is NotFound", async () => {
    await expect(
      deleteCategory({ id: "nope" }, setup().deps)
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe("getCategoryTree", () => {
  it("nests categories with their listing counts, by name", async () => {
    const t = setup([cat("tours"), cat("walks", "tours"), cat("events")], {
      listings: { walks: 3 },
    })
    const tree = await getCategoryTree(t.deps)

    expect(tree.map((n) => n.id)).toEqual(["tours", "events"])
    expect(tree[0]?.children[0]).toMatchObject({ id: "walks", listingCount: 3 })
    expect(tree[1]?.listingCount).toBe(0)
  })
})
