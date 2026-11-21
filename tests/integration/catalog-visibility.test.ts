import type { ListingStatus, PrismaClient, VendorStatus } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import {
  assertVendorCanSell,
  publiclyVisibleListingWhere,
} from "@/lib/catalog/visibility"
import { ForbiddenError, NotFoundError } from "@/lib/errors"
import { transitionVendor } from "@/lib/services/vendor-governance"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

const VENDOR_STATUSES: VendorStatus[] = [
  "PENDING",
  "APPROVED",
  "SUSPENDED",
  "REJECTED",
]
const LISTING_STATUSES: ListingStatus[] = [
  "DRAFT",
  "PENDING_REVIEW",
  "PUBLISHED",
  "REJECTED",
  "ARCHIVED",
]

let prisma: PrismaClient
let h: AuthHarness
let categoryId: string

beforeAll(() => {
  prisma = createTestPrismaClient()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await truncatePublicSchema(prisma)
  h = makeHarness({ database: prismaAuthDatabase(prisma) })
  categoryId = (
    await prisma.category.create({
      data: { name: "Tours", slug: "tours", type: "TIMED_SLOT" },
    })
  ).id
})

let counter = 0
const unique = () => `${(counter += 1)}-${Date.now()}`

async function vendor(status: VendorStatus, onboarded = false) {
  return prisma.vendor.create({
    data: {
      name: `Vendor ${unique()}`,
      slug: `vendor-${unique()}`,
      status,
      stripeOnboardingComplete: onboarded,
    },
  })
}

async function listing(
  vendorId: string,
  status: ListingStatus,
  overrides: { categoryId?: string } = {}
) {
  return prisma.listing.create({
    data: {
      vendorId,
      categoryId: overrides.categoryId ?? categoryId,
      title: `Listing ${unique()}`,
      slug: `listing-${unique()}`,
      status,
    },
  })
}

const visibleIds = async (
  extra?: Parameters<typeof publiclyVisibleListingWhere>[0]
) =>
  (
    await prisma.listing.findMany({
      where: publiclyVisibleListingWhere(extra),
      select: { id: true },
    })
  )
    .map((l) => l.id)
    .sort()

async function admin() {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole: "ADMIN" },
  })

  return { id: row.id, session: await h.sessionFor(email, password) }
}

describe("public visibility on Postgres", () => {
  it("IT-17: of every vendor-status x listing-status combination, only PUBLISHED listings of APPROVED vendors are visible", async () => {
    let expected = ""
    let total = 0

    for (const vendorStatus of VENDOR_STATUSES) {
      const v = await vendor(vendorStatus)

      for (const listingStatus of LISTING_STATUSES) {
        const l = await listing(v.id, listingStatus)
        total += 1

        if (vendorStatus === "APPROVED" && listingStatus === "PUBLISHED") {
          expected = l.id
        }
      }
    }

    expect(total).toBe(20)
    expect(await visibleIds()).toEqual([expected])
  })

  it("TC-E8S1-02: suspending a vendor removes its listings from the public query at once, and reinstating restores them", async () => {
    const a = await admin()
    const v = await vendor("PENDING")
    const l = await listing(v.id, "PUBLISHED")

    // A pending vendor's published listing is not public yet.
    expect(await visibleIds()).toEqual([])

    await transitionVendor(
      { vendorId: v.id, action: "approve" },
      { session: a.session, db: prisma }
    )
    expect(await visibleIds()).toEqual([l.id])

    await transitionVendor(
      { vendorId: v.id, action: "suspend", reason: "Under review" },
      { session: a.session, db: prisma }
    )
    expect(await visibleIds()).toEqual([])

    await transitionVendor(
      { vendorId: v.id, action: "reinstate" },
      { session: a.session, db: prisma }
    )
    expect(await visibleIds()).toEqual([l.id])
  })

  it("TC-E8S1-32: extra filters narrow the result but can never widen it", async () => {
    const other = await prisma.category.create({
      data: { name: "Events", slug: "events", type: "TIMED_SLOT" },
    })
    const v = await vendor("APPROVED")
    const tour = await listing(v.id, "PUBLISHED")
    await listing(v.id, "PUBLISHED", { categoryId: other.id })
    const draft = await listing(v.id, "DRAFT")
    const suspended = await listing((await vendor("SUSPENDED")).id, "PUBLISHED")

    expect(await visibleIds({ categoryId })).toEqual([tour.id])

    // Asking for drafts, or for a suspended vendor's listing, yields nothing.
    expect(await visibleIds({ status: "DRAFT" })).toEqual([])
    expect(await visibleIds({ id: draft.id })).toEqual([])
    expect(await visibleIds({ id: suspended.id })).toEqual([])
    expect(await visibleIds({ vendor: { status: "SUSPENDED" } })).toEqual([])
  })
})

describe("assertVendorCanSell on Postgres", () => {
  it("IT-14 (stub): an approved, onboarded vendor passes; an unapproved or non-onboarded one is refused with the reason", async () => {
    const ready = await vendor("APPROVED", true)
    await expect(assertVendorCanSell(ready.id, prisma)).resolves.toBeUndefined()

    const notOnboarded = await vendor("APPROVED", false)
    const error = await assertVendorCanSell(notOnboarded.id, prisma).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(ForbiddenError)
    expect((error as ForbiddenError).details).toEqual({
      reason: "NOT_ONBOARDED",
    })

    for (const status of ["PENDING", "SUSPENDED", "REJECTED"] as const) {
      const v = await vendor(status, true)
      const refused = await assertVendorCanSell(v.id, prisma).catch(
        (e: unknown) => e
      )

      expect(refused, status).toBeInstanceOf(ForbiddenError)
      expect((refused as ForbiddenError).details).toEqual({
        reason: "NOT_APPROVED",
      })
    }
  })

  it("TC-E8S1-33: an unknown vendor is a NotFoundError", async () => {
    await expect(
      assertVendorCanSell("no-such-vendor", prisma)
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("TC-E8S1-34: it can run inside a transaction and sees that transaction's own writes", async () => {
    const v = await vendor("APPROVED", false)

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.vendor.update({
          where: { id: v.id },
          data: { stripeOnboardingComplete: true },
        })

        await assertVendorCanSell(v.id, tx)

        return "allowed"
      })
    ).resolves.toBe("allowed")

    // Outside, before the change it was refused; the commit made it allowed.
    await expect(assertVendorCanSell(v.id, prisma)).resolves.toBeUndefined()
  })
})
