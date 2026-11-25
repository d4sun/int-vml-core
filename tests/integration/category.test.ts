import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors"
import {
  createCategory,
  deleteCategory,
  getCategoryTree,
  updateCategory,
} from "@/lib/services/category"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

let prisma: PrismaClient
let h: AuthHarness

beforeAll(() => {
  prisma = createTestPrismaClient()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await truncatePublicSchema(prisma)
  h = makeHarness({ database: prismaAuthDatabase(prisma) })
})

async function user(platformRole: PlatformRole) {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole },
  })

  return { id: row.id, session: await h.sessionFor(email, password) }
}

const admin = async () => {
  const a = await user("ADMIN")

  return { admin: a, deps: { session: a.session, db: prisma } }
}

const auditFor = (entityId: string) =>
  prisma.auditLog.findMany({
    where: { entityType: "Category", entityId },
    orderBy: { at: "asc" },
  })

describe("categories on Postgres", () => {
  it("creates a tree with generated slugs, and audits each creation with the admin as actor", async () => {
    const { admin: a, deps } = await admin()
    const tours = await createCategory(
      { name: "Tours", commissionBpsDefault: 1200 },
      deps
    )
    const walks = await createCategory(
      { name: "Walking Tours", parentId: tours.id },
      deps
    )

    expect(tours).toMatchObject({
      slug: "tours",
      parentId: null,
      type: "TIMED_SLOT",
      commissionBpsDefault: 1200,
    })
    expect(walks).toMatchObject({
      slug: "walking-tours",
      parentId: tours.id,
      commissionBpsDefault: 1000,
    })

    const [row] = await auditFor(tours.id)

    expect(row).toMatchObject({ actorId: a.id, action: "category.created" })
  })

  it("the tree reads back nested, by name, with listing counts", async () => {
    const { deps } = await admin()
    const tours = await createCategory({ name: "Tours" }, deps)
    const events = await createCategory({ name: "Events" }, deps)

    await createCategory({ name: "Food", parentId: tours.id }, deps)
    await createCategory({ name: "Art", parentId: tours.id }, deps)

    const tree = await getCategoryTree(deps)

    expect(tree.map((n) => n.name)).toEqual(["Events", "Tours"])
    expect(tree[1]?.children.map((n) => n.name)).toEqual(["Art", "Food"])
    expect(tree[0]?.id).toBe(events.id)
    expect(tree[0]?.listingCount).toBe(0)
  })

  it("the same slug twice is a Conflict and the database keeps one row", async () => {
    const { deps } = await admin()

    await createCategory({ name: "Tours" }, deps)
    await expect(
      createCategory({ name: "Tours" }, deps)
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await prisma.category.count()).toBe(1)
  })

  it("two creates of one slug at the same moment leave one category", async () => {
    const { deps } = await admin()
    const results = await Promise.allSettled([
      createCategory({ name: "Tours" }, deps),
      createCategory({ name: "Tours" }, deps),
    ])

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(await prisma.category.count()).toBe(1)
  })

  it("TC-E9S2-03: a loop is refused against the real tree, however deep", async () => {
    const { deps } = await admin()
    const a = await createCategory({ name: "A" }, deps)
    const b = await createCategory({ name: "B", parentId: a.id }, deps)
    const c = await createCategory({ name: "C", parentId: b.id }, deps)

    for (const [id, parentId] of [
      [a.id, a.id],
      [a.id, b.id],
      [a.id, c.id],
      [b.id, c.id],
    ]) {
      await expect(
        updateCategory({ id, parentId }, deps)
      ).rejects.toBeInstanceOf(ValidationError)
    }

    expect(
      (await prisma.category.findUniqueOrThrow({ where: { id: a.id } }))
        .parentId
    ).toBeNull()
  })

  it("two opposite moves at the same moment cannot make a loop", async () => {
    const { deps } = await admin()
    const a = await createCategory({ name: "A" }, deps)
    const b = await createCategory({ name: "B" }, deps)

    await Promise.allSettled([
      updateCategory({ id: a.id, parentId: b.id }, deps),
      updateCategory({ id: b.id, parentId: a.id }, deps),
    ])

    const rows = await prisma.category.findMany()
    const parentOf = new Map(rows.map((r) => [r.id, r.parentId]))

    // Walking up from either must reach a root.
    for (const row of rows) {
      let current: string | null = row.id
      let steps = 0

      while (current !== null && steps++ < 10)
        current = parentOf.get(current) ?? null

      expect(current, row.name).toBeNull()
    }
  })

  it("nesting is limited to three levels", async () => {
    const { deps } = await admin()
    const a = await createCategory({ name: "A" }, deps)
    const b = await createCategory({ name: "B", parentId: a.id }, deps)
    const c = await createCategory({ name: "C", parentId: b.id }, deps)

    await expect(
      createCategory({ name: "D", parentId: c.id }, deps)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await prisma.category.count()).toBe(3)
  })

  it("moves a category to the top level and back, auditing both", async () => {
    const { deps } = await admin()
    const a = await createCategory({ name: "A" }, deps)
    const b = await createCategory({ name: "B", parentId: a.id }, deps)

    await updateCategory({ id: b.id, parentId: null }, deps)
    await updateCategory({ id: b.id, parentId: a.id }, deps)

    expect((await auditFor(b.id)).map((r) => r.action)).toEqual([
      "category.created",
      "category.updated",
      "category.updated",
    ])
  })

  it("TC-E9S2-01: a category with a listing cannot be deleted, and can once the listing is gone", async () => {
    const { deps } = await admin()
    const tours = await createCategory({ name: "Tours" }, deps)
    const owner = await user("VENDOR")
    const vendor = await prisma.vendor.create({
      data: {
        name: "V",
        slug: `v-${Date.now()}`,
        status: "APPROVED",
        members: { create: { userId: owner.id, role: "OWNER" } },
      },
    })
    const listing = await prisma.listing.create({
      data: {
        vendorId: vendor.id,
        categoryId: tours.id,
        title: "T",
        slug: `t-${Date.now()}`,
      },
    })

    const error = await deleteCategory({ id: tours.id }, deps).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toMatchObject({
      reason: "HAS_LISTINGS",
    })
    expect(await prisma.category.count()).toBe(1)
    expect((await getCategoryTree(deps))[0]?.listingCount).toBe(1)

    await prisma.listing.delete({ where: { id: listing.id } })
    await deleteCategory({ id: tours.id }, deps)

    expect(await prisma.category.count()).toBe(0)
    expect((await auditFor(tours.id)).map((r) => r.action)).toEqual([
      "category.created",
      "category.deleted",
    ])
  })

  it("a category with children cannot be deleted, so no sub-category is orphaned", async () => {
    const { deps } = await admin()
    const a = await createCategory({ name: "A" }, deps)
    const b = await createCategory({ name: "B", parentId: a.id }, deps)

    await expect(deleteCategory({ id: a.id }, deps)).rejects.toMatchObject({
      details: { reason: "HAS_CHILDREN" },
    })
    expect(
      (await prisma.category.findUniqueOrThrow({ where: { id: b.id } }))
        .parentId
    ).toBe(a.id)
  })

  it("TC-E9S2-02: changing the default commission leaves existing bookings untouched", async () => {
    const { deps } = await admin()
    const tours = await createCategory(
      { name: "Tours", commissionBpsDefault: 1000 },
      deps
    )
    const owner = await user("VENDOR")
    const tourist = await user("TOURIST")
    const vendor = await prisma.vendor.create({
      data: {
        name: "V",
        slug: `v-${Date.now()}`,
        status: "APPROVED",
        members: { create: { userId: owner.id, role: "OWNER" } },
      },
    })
    const listing = await prisma.listing.create({
      data: {
        vendorId: vendor.id,
        categoryId: tours.id,
        title: "T",
        slug: `t-${Date.now()}`,
        status: "PUBLISHED",
      },
    })
    const product = await prisma.product.create({
      data: {
        listingId: listing.id,
        name: "Ticket",
        basePrice: 2500,
        policy: {},
      },
    })
    const slot = await prisma.availability.create({
      data: {
        productId: product.id,
        startAt: new Date("2027-01-01T10:00:00Z"),
        endAt: new Date("2027-01-01T12:00:00Z"),
        capacity: 10,
        remaining: 9,
      },
    })
    const booking = await prisma.booking.create({
      data: {
        touristUserId: tourist.id,
        total: 2500,
        status: "CONFIRMED",
        items: {
          create: {
            productId: product.id,
            availabilityId: slot.id,
            vendorId: vendor.id,
            quantity: 1,
            unitPrice: 2500,
            subtotal: 2500,
            commissionAmount: 250,
          },
        },
      },
      include: { items: true },
    })

    await updateCategory({ id: tours.id, commissionBpsDefault: 2000 }, deps)

    const item = await prisma.bookingItem.findUniqueOrThrow({
      where: { id: booking.items[0]!.id },
    })

    expect(item.commissionAmount).toBe(250)
    expect(item.subtotal).toBe(2500)
    expect(
      (await prisma.category.findUniqueOrThrow({ where: { id: tours.id } }))
        .commissionBpsDefault
    ).toBe(2000)
  })

  it("each change and its audit row commit together: a failing audit write undoes the change", async () => {
    const { deps } = await admin()
    const failing = {
      ...deps,
      record: async () => {
        throw new Error("audit down")
      },
    }
    const tours = await createCategory({ name: "Tours" }, deps)

    await expect(createCategory({ name: "Events" }, failing)).rejects.toThrow(
      "audit down"
    )
    await expect(
      updateCategory({ id: tours.id, name: "Changed" }, failing)
    ).rejects.toThrow("audit down")
    await expect(deleteCategory({ id: tours.id }, failing)).rejects.toThrow(
      "audit down"
    )

    const rows = await prisma.category.findMany()

    expect(rows.map((r) => r.name)).toEqual(["Tours"])
  })

  it("a vendor or tourist cannot change anything, and the database is untouched", async () => {
    const { deps } = await admin()
    const tours = await createCategory({ name: "Tours" }, deps)

    for (const role of ["VENDOR", "TOURIST"] as const) {
      const other = await user(role)
      const theirs = { session: other.session, db: prisma }

      await expect(
        createCategory({ name: "X" }, theirs)
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(
        updateCategory({ id: tours.id, name: "X" }, theirs)
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(
        deleteCategory({ id: tours.id }, theirs)
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(getCategoryTree(theirs)).rejects.toBeInstanceOf(
        ForbiddenError
      )
    }

    expect((await prisma.category.findMany()).map((r) => r.name)).toEqual([
      "Tours",
    ])
  })
})
