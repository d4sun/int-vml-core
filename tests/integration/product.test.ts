import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors"
import {
  createProduct,
  deleteProduct,
  listListingProducts,
  updateProduct,
} from "@/lib/services/product"
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

async function user(platformRole: PlatformRole = "VENDOR") {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole },
  })

  return { id: row.id, session: await h.sessionFor(email, password) }
}

let n = 0
async function setup(
  options: {
    status?: "DRAFT" | "PUBLISHED" | "PENDING_REVIEW"
    vendorStatus?: "APPROVED" | "SUSPENDED"
  } = {}
) {
  n += 1

  const owner = await user()
  const category = await prisma.category.create({
    data: { name: `C${n}`, slug: `c-${n}-${Date.now()}`, type: "TIMED_SLOT" },
  })
  const vendor = await prisma.vendor.create({
    data: {
      name: `V${n}`,
      slug: `v-${n}-${Date.now()}`,
      status: options.vendorStatus ?? "APPROVED",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "Walk",
      slug: `walk-${n}-${Date.now()}`,
      status: options.status ?? "DRAFT",
    },
  })

  return {
    owner,
    vendor,
    listing,
    deps: { session: owner.session, db: prisma },
  }
}

type S = Awaited<ReturnType<typeof setup>>

const make = (s: S, over: Record<string, unknown> = {}) =>
  createProduct(
    {
      listingId: s.listing.id,
      name: "Standard ticket",
      basePrice: 2500,
      ...over,
    },
    s.deps
  )

describe("products on Postgres", () => {
  it("creates a timed-slot product in GBP, active, with the default policy", async () => {
    const s = await setup()
    const product = await make(s)

    expect(product).toMatchObject({
      listingId: s.listing.id,
      name: "Standard ticket",
      basePrice: 2500,
      currency: "GBP",
      active: true,
      policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
    })

    const row = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    })

    expect(row.kind).toBe("TIMED_SLOT")
    expect(row.policy).toEqual({ cancelWindowHours: 24, bookingCutoffHours: 2 })
  })

  it("TC-E5S2-04: a policy above the platform maximum is rejected and nothing is stored", async () => {
    const s = await setup()

    for (const policy of [
      { cancelWindowHours: 721, bookingCutoffHours: 2 },
      { cancelWindowHours: 24, bookingCutoffHours: 169 },
      { cancelWindowHours: -1, bookingCutoffHours: 2 },
    ]) {
      const error = await make(s, { policy }).catch((e: unknown) => e)

      expect(error, JSON.stringify(policy)).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).fieldErrors).toBeDefined()
    }

    expect(await prisma.product.count()).toBe(0)

    const stored = await make(s, {
      policy: { cancelWindowHours: 720, bookingCutoffHours: 168 },
    })

    expect(stored.policy).toEqual({
      cancelWindowHours: 720,
      bookingCutoffHours: 168,
    })
  })

  it("an update outside the bounds, or below the minimum price, changes nothing", async () => {
    const s = await setup()
    const product = await make(s)

    await expect(
      updateProduct(
        {
          id: product.id,
          policy: { cancelWindowHours: 9999, bookingCutoffHours: 2 },
        },
        s.deps
      )
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      updateProduct({ id: product.id, basePrice: 10 }, s.deps)
    ).rejects.toBeInstanceOf(ValidationError)

    expect(
      await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    ).toMatchObject({
      basePrice: 2500,
      policy: { cancelWindowHours: 24, bookingCutoffHours: 2 },
    })
  })

  it("edits name, price, policy and the on/off switch; a no-op writes nothing", async () => {
    const s = await setup()
    const product = await make(s)
    const updated = await updateProduct(
      {
        id: product.id,
        name: "Family ticket",
        basePrice: 7000,
        active: false,
        policy: { cancelWindowHours: 48, bookingCutoffHours: 6 },
      },
      s.deps
    )

    expect(updated).toMatchObject({
      name: "Family ticket",
      basePrice: 7000,
      active: false,
      policy: { cancelWindowHours: 48, bookingCutoffHours: 6 },
    })

    const before = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    })

    await updateProduct({ id: product.id, name: "Family ticket" }, s.deps)

    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: product.id } }))
        .updatedAt
    ).toEqual(before.updatedAt)
  })

  it("lists only this listing's products, oldest first", async () => {
    const s = await setup()
    const other = await setup()
    const a = await make(s, { name: "A ticket" })
    const b = await make(s, { name: "B ticket" })

    await make(other, { name: "Other" })

    expect(
      (await listListingProducts({ listingId: s.listing.id }, s.deps)).map(
        (p) => p.id
      )
    ).toEqual([a.id, b.id])
  })

  it("another vendor cannot create, list, edit or delete, and nothing changes", async () => {
    const s = await setup()
    const rival = await setup()
    const product = await make(s)
    const theirs = rival.deps

    await expect(
      createProduct(
        { listingId: s.listing.id, name: "Hijack", basePrice: 100 },
        theirs
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      listListingProducts({ listingId: s.listing.id }, theirs)
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      updateProduct({ id: product.id, name: "Hijack" }, theirs)
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      deleteProduct({ id: product.id }, theirs)
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      updateProduct(
        { id: "00000000-0000-0000-0000-000000000000", name: "Nothing" },
        theirs
      )
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(await prisma.product.count()).toBe(1)
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: product.id } }))
        .name
    ).toBe("Standard ticket")
  })

  it("the currency, kind, active flag and ids cannot be set by the client", async () => {
    const s = await setup()

    for (const extra of [
      { currency: "USD" },
      { kind: "TABLE" },
      { active: false },
      { id: "x" },
    ]) {
      await expect(make(s, extra)).rejects.toBeInstanceOf(ValidationError)
    }
  })

  it("a listing under review is frozen for products, and a suspended vendor cannot change them", async () => {
    const review = await setup({ status: "PENDING_REVIEW" })

    await expect(make(review)).rejects.toBeInstanceOf(ConflictError)

    const suspended = await setup({ vendorStatus: "SUSPENDED" })

    await expect(make(suspended)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("a published listing's products can be edited (bookings keep their own price snapshot)", async () => {
    const s = await setup({ status: "PUBLISHED" })
    const product = await make(s)

    expect(
      (await updateProduct({ id: product.id, basePrice: 3000 }, s.deps))
        .basePrice
    ).toBe(3000)
    expect(
      (await prisma.listing.findUniqueOrThrow({ where: { id: s.listing.id } }))
        .status
    ).toBe("PUBLISHED")
  })

  it("an unbooked product can be deleted, with its slots; a booked one is kept", async () => {
    const s = await setup()
    const free = await make(s, { name: "Free to delete" })
    const booked = await make(s, { name: "Booked" })
    const tourist = await user("TOURIST")
    const slot = await prisma.availability.create({
      data: {
        productId: booked.id,
        startAt: new Date("2027-01-01T10:00:00Z"),
        endAt: new Date("2027-01-01T12:00:00Z"),
        capacity: 5,
        remaining: 4,
      },
    })
    const freeSlot = await prisma.availability.create({
      data: {
        productId: free.id,
        startAt: new Date("2027-01-02T10:00:00Z"),
        endAt: new Date("2027-01-02T12:00:00Z"),
        capacity: 5,
        remaining: 5,
      },
    })

    await prisma.booking.create({
      data: {
        touristUserId: tourist.id,
        total: 2500,
        items: {
          create: {
            productId: booked.id,
            availabilityId: slot.id,
            vendorId: s.vendor.id,
            quantity: 1,
            unitPrice: 2500,
            subtotal: 2500,
            commissionAmount: 250,
          },
        },
      },
    })

    await deleteProduct({ id: free.id }, s.deps)
    expect(
      await prisma.product.findUnique({ where: { id: free.id } })
    ).toBeNull()
    expect(
      await prisma.availability.findUnique({ where: { id: freeSlot.id } })
    ).toBeNull()

    const error = await deleteProduct({ id: booked.id }, s.deps).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toMatchObject({
      reason: "HAS_BOOKINGS",
      bookings: 1,
    })
    expect(
      await prisma.product.findUnique({ where: { id: booked.id } })
    ).not.toBeNull()

    // Switching it off is the way out.
    expect(
      (await updateProduct({ id: booked.id, active: false }, s.deps)).active
    ).toBe(false)
  })
})
