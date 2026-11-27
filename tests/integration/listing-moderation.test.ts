import type {
  ListingStatus,
  PlatformRole,
  PrismaClient,
  VendorStatus,
} from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { publiclyVisibleListingWhere } from "@/lib/catalog/visibility"
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors"
import { submitListing } from "@/lib/services/listing"
import { moderateListing } from "@/lib/services/listing-moderation"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

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

async function account(platformRole: PlatformRole, name: string) {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole, name },
  })

  return { id: row.id, session: await h.sessionFor(email, password) }
}

let n = 0
async function vendor(
  status: VendorStatus = "APPROVED",
  stripeOnboardingComplete = true
) {
  n += 1

  return prisma.vendor.create({
    data: {
      name: `Vendor ${n}`,
      slug: `vendor-${n}-${Date.now()}`,
      status,
      stripeOnboardingComplete,
    },
  })
}

async function listing(
  vendorId: string,
  status: ListingStatus = "PENDING_REVIEW"
) {
  n += 1

  return prisma.listing.create({
    data: {
      vendorId,
      categoryId,
      title: `Walk ${n}`,
      slug: `walk-${n}-${Date.now()}`,
      status,
    },
  })
}

const statusOf = async (id: string) =>
  (await prisma.listing.findUniqueOrThrow({ where: { id } })).status

const deps = (session: Awaited<ReturnType<typeof account>>["session"]) => ({
  session,
  db: prisma,
})

/** The refusal's reason, or null when the call succeeds. */
async function refusalReason(
  run: () => Promise<unknown>
): Promise<string | null> {
  try {
    await run()

    return null
  } catch (error) {
    return (error as { details?: { reason?: string } }).details?.reason ?? "?"
  }
}

describe("listing moderation (Postgres)", () => {
  it("TC-E9S1-01: approve publishes a pending listing, and it becomes publicly visible", async () => {
    const admin = await account("ADMIN", "Admin")
    const v = await vendor()
    const l = await listing(v.id)

    const approved = await moderateListing(
      { listingId: l.id, action: "approve" },
      deps(admin.session)
    )

    expect(approved.status).toBe("PUBLISHED")
    expect(await statusOf(l.id)).toBe("PUBLISHED")

    const visible = await prisma.listing.findMany({
      where: publiclyVisibleListingWhere({ id: l.id }),
    })

    expect(visible.map((row) => row.id)).toEqual([l.id])
  })

  it("TC-E9S1-01: the approval is audited with the actor and the change", async () => {
    const admin = await account("ADMIN", "Admin")
    const l = await listing((await vendor()).id)

    await moderateListing(
      { listingId: l.id, action: "approve" },
      deps(admin.session)
    )

    const rows = await prisma.auditLog.findMany({
      where: { entityId: l.id, action: "listing.approved" },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]!.actorId).toBe(admin.id)
    expect(rows[0]!.meta).toMatchObject({
      from: "PENDING_REVIEW",
      to: "PUBLISHED",
    })
  })

  it("TC-E9S1-02: reject with a reason keeps the listing out of public view and records the reason", async () => {
    const admin = await account("ADMIN", "Admin")
    const l = await listing((await vendor()).id)

    const rejected = await moderateListing(
      {
        listingId: l.id,
        action: "reject",
        reason: "Photos do not match the tour",
      },
      deps(admin.session)
    )

    expect(rejected.status).toBe("REJECTED")

    const visible = await prisma.listing.count({
      where: publiclyVisibleListingWhere({ id: l.id }),
    })

    expect(visible).toBe(0)

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: l.id, action: "listing.rejected" },
    })

    expect(row.meta).toMatchObject({
      reason: "Photos do not match the tour",
    })
  })

  it("TC-E9S1-02: a rejected listing is resubmittable and returns to review", async () => {
    const admin = await account("ADMIN", "Admin")
    const owner = await account("VENDOR", "Olive")
    const v = await vendor()
    await prisma.vendorMember.create({
      data: { vendorId: v.id, userId: owner.id, role: "OWNER" },
    })
    const l = await listing(v.id)

    await moderateListing(
      { listingId: l.id, action: "reject", reason: "Fix the title" },
      deps(admin.session)
    )

    const resubmitted = await submitListing(
      { id: l.id },
      { session: owner.session, db: prisma }
    )

    expect(resubmitted.status).toBe("PENDING_REVIEW")
  })

  it("IT-14: approving a listing of a vendor that has not finished payout setup is refused and nothing changes", async () => {
    const admin = await account("ADMIN", "Admin")
    const v = await vendor("APPROVED", false)
    const l = await listing(v.id)

    expect(
      await refusalReason(() =>
        moderateListing(
          { listingId: l.id, action: "approve" },
          deps(admin.session)
        )
      )
    ).toBe("NOT_ONBOARDED")

    expect(await statusOf(l.id)).toBe("PENDING_REVIEW")
    expect(await prisma.auditLog.count({ where: { entityId: l.id } })).toBe(0)
  })

  it("IT-14: approving a listing of a suspended vendor is refused", async () => {
    const admin = await account("ADMIN", "Admin")
    const v = await vendor("SUSPENDED", true)
    const l = await listing(v.id)

    expect(
      await refusalReason(() =>
        moderateListing(
          { listingId: l.id, action: "approve" },
          deps(admin.session)
        )
      )
    ).toBe("NOT_APPROVED")

    expect(await statusOf(l.id)).toBe("PENDING_REVIEW")
  })

  it("rejecting does not depend on the vendor's payout state", async () => {
    const admin = await account("ADMIN", "Admin")
    const v = await vendor("SUSPENDED", false)
    const l = await listing(v.id)

    await moderateListing(
      { listingId: l.id, action: "reject", reason: "Not suitable" },
      deps(admin.session)
    )

    expect(await statusOf(l.id)).toBe("REJECTED")
  })

  it.each(["DRAFT", "PUBLISHED", "REJECTED", "ARCHIVED"] as const)(
    "a %s listing cannot be approved",
    async (status) => {
      const admin = await account("ADMIN", "Admin")
      const l = await listing((await vendor()).id, status)

      await expect(
        moderateListing(
          { listingId: l.id, action: "approve" },
          deps(admin.session)
        )
      ).rejects.toThrow(ConflictError)

      expect(await statusOf(l.id)).toBe(status)
    }
  )

  it("an unknown listing is not found", async () => {
    const admin = await account("ADMIN", "Admin")

    await expect(
      moderateListing(
        {
          listingId: "00000000-0000-0000-0000-000000000000",
          action: "approve",
        },
        deps(admin.session)
      )
    ).rejects.toThrow(NotFoundError)
  })

  it("a vendor cannot publish its own listing", async () => {
    const owner = await account("VENDOR", "Olive")
    const v = await vendor()
    await prisma.vendorMember.create({
      data: { vendorId: v.id, userId: owner.id, role: "OWNER" },
    })
    const l = await listing(v.id)

    await expect(
      moderateListing(
        { listingId: l.id, action: "approve" },
        deps(owner.session)
      )
    ).rejects.toThrow(ForbiddenError)

    expect(await statusOf(l.id)).toBe("PENDING_REVIEW")
  })
})
