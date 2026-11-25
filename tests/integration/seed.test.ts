import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  DEFAULT_SEED_PASSWORD,
  SEED_USERS,
  seedDatabase,
} from "../../prisma/seed-core"
import { SEED_CATEGORIES } from "@/lib/categories/taxonomy"
import { prismaAuthDatabase } from "@/lib/auth/config"
import {
  prismaMembershipStore,
  requireAdmin,
  requireRole,
  requireVendorMember,
} from "@/lib/auth/guards"
import { ForbiddenError } from "@/lib/errors"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { freshIp, makeHarness, type AuthHarness } from "../helpers/auth-harness"

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

const counts = async () => ({
  users: await prisma.user.count(),
  accounts: await prisma.account.count(),
  vendors: await prisma.vendor.count(),
  members: await prisma.vendorMember.count(),
  categories: await prisma.category.count(),
  listings: await prisma.listing.count(),
  products: await prisma.product.count(),
  slots: await prisma.availability.count(),
})

describe("seed on Postgres", () => {
  it("TC-E0S3-37: seeding twice leaves the same rows (idempotent)", async () => {
    await seedDatabase(prisma)
    const first = await counts()

    await seedDatabase(prisma)
    await seedDatabase(prisma)

    expect(await counts()).toEqual(first)
    expect(first).toEqual({
      users: 4,
      accounts: 4,
      vendors: 1,
      members: 2,
      categories: 7,
      listings: 1,
      products: 1,
      slots: 1,
    })
  })

  it("E9-S2-02: seeds the top-level categories, timed-slot, at the default commission, none nested", async () => {
    await seedDatabase(prisma)

    const rows = await prisma.category.findMany({ orderBy: { slug: "asc" } })

    expect(rows.map((r) => r.slug)).toEqual(
      [...SEED_CATEGORIES.map((c) => c.slug)].sort()
    )
    expect(rows.every((r) => r.parentId === null)).toBe(true)
    expect(rows.every((r) => r.type === "TIMED_SLOT")).toBe(true)
    expect(rows.every((r) => r.commissionBpsDefault === 1000)).toBe(true)
  })

  it("E9-S2-02: a re-seed keeps what an admin changed and restores a deleted category", async () => {
    await seedDatabase(prisma)
    await prisma.category.update({
      where: { slug: "tours" },
      data: { name: "Guided tours", commissionBpsDefault: 1500 },
    })
    await prisma.category.delete({ where: { slug: "music" } })

    await seedDatabase(prisma)

    const tours = await prisma.category.findUniqueOrThrow({
      where: { slug: "tours" },
    })

    expect(tours).toMatchObject({
      name: "Guided tours",
      commissionBpsDefault: 1500,
    })
    expect(await prisma.category.count()).toBe(SEED_CATEGORIES.length)
  })

  it("TC-E0S3-38: a re-run adds a fresh slot only once the old one has passed", async () => {
    const start = new Date("2026-06-01T09:00:00Z")
    await seedDatabase(prisma, { now: start })
    await seedDatabase(prisma, { now: new Date("2026-06-02T09:00:00Z") })

    expect(await prisma.availability.count()).toBe(1)

    await seedDatabase(prisma, { now: new Date("2026-06-10T09:00:00Z") })

    expect(await prisma.availability.count()).toBe(2)
  })

  it("TC-E0S3-39: every seeded user can sign in with the seed password and gets the right role", async () => {
    await seedDatabase(prisma)

    for (const seed of SEED_USERS) {
      const response = await h.signIn(
        { email: seed.email, password: DEFAULT_SEED_PASSWORD },
        freshIp()
      )

      expect(response.status, seed.email).toBe(200)

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: seed.email },
      })
      expect(user.platformRole).toBe(seed.platformRole)
      expect(user.emailVerified).toBe(true)
    }
  })

  it("TC-E0S3-40: the seeded roles pass and fail the guards as designed", async () => {
    const { vendorId } = await seedDatabase(prisma)
    const as = (email: string) => h.sessionFor(email, DEFAULT_SEED_PASSWORD)
    const memberships = prismaMembershipStore(prisma)

    const [admin, owner, staff, tourist] = await Promise.all([
      as("admin@seed.vml.test"),
      as("owner@seed.vml.test"),
      as("staff@seed.vml.test"),
      as("tourist@seed.vml.test"),
    ])

    expect((await requireAdmin(admin)).platformRole).toBe("ADMIN")
    await expect(requireAdmin(owner)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(requireRole("VENDOR", tourist)).rejects.toBeInstanceOf(
      ForbiddenError
    )

    expect(
      (
        await requireVendorMember(vendorId, ["OWNER"], {
          session: owner,
          memberships,
        })
      ).vendorRole
    ).toBe("OWNER")
    expect(
      (
        await requireVendorMember(vendorId, undefined, {
          session: staff,
          memberships,
        })
      ).vendorRole
    ).toBe("STAFF")
    await expect(
      requireVendorMember(vendorId, ["OWNER"], { session: staff, memberships })
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      requireVendorMember(vendorId, undefined, { session: admin, memberships })
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("TC-E0S3-41: re-seeding with the same password keeps the hash; a new password replaces it", async () => {
    await seedDatabase(prisma, { password: "First-password-1" })
    const before = await prisma.account.findMany({ orderBy: { userId: "asc" } })

    await seedDatabase(prisma, { password: "First-password-1" })
    const same = await prisma.account.findMany({ orderBy: { userId: "asc" } })
    expect(same.map((a) => a.password)).toEqual(before.map((a) => a.password))

    await seedDatabase(prisma, { password: "Second-password-2" })

    expect(
      (
        await h.signIn(
          { email: "tourist@seed.vml.test", password: "First-password-1" },
          freshIp()
        )
      ).status
    ).toBe(401)
    expect(
      (
        await h.signIn(
          { email: "tourist@seed.vml.test", password: "Second-password-2" },
          freshIp()
        )
      ).status
    ).toBe(200)
  })

  it("TC-E0S3-42: re-seeding restores roles and vendor approval that were changed", async () => {
    const { vendorId, userIds } = await seedDatabase(prisma)

    await prisma.user.update({
      where: { id: userIds.admin },
      data: { platformRole: "TOURIST" },
    })
    await prisma.vendor.update({
      where: { id: vendorId },
      data: { status: "SUSPENDED" },
    })

    await seedDatabase(prisma)

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userIds.admin } }))
        .platformRole
    ).toBe("ADMIN")
    expect(
      (await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } }))
        .status
    ).toBe("APPROVED")
  })
})
