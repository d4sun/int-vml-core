import type {
  ListingStatus,
  PlatformRole,
  PrismaClient,
  VendorRole,
  VendorStatus,
} from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { ForbiddenError, NotFoundError } from "@/lib/errors"
import {
  getListingForReview,
  listPendingListings,
} from "@/lib/services/listing-admin"
import { moderateListing } from "@/lib/services/listing-moderation"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"
import {
  RecordingTransactionalQueue,
  TEST_APP_URL,
} from "../helpers/recording-transactional-queue"

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

  return { id: row.id, email, session: await h.sessionFor(email, password) }
}

let n = 0
async function vendor(
  members: { userId: string; role: VendorRole }[],
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
      members: { create: members },
    },
  })
}

async function listing(
  vendorId: string,
  title: string,
  status: ListingStatus = "PENDING_REVIEW"
) {
  n += 1

  return prisma.listing.create({
    data: {
      vendorId,
      categoryId,
      title,
      slug: `listing-${n}-${Date.now()}`,
      status,
    },
  })
}

/** A queue whose enqueue always fails, to prove the decision rolls back. */
const brokenQueue = {
  async enqueueInTransaction(): Promise<boolean> {
    throw new Error("simulated queue outage")
  },
}

const emailDeps = (
  session: Awaited<ReturnType<typeof account>>["session"],
  queue = new RecordingTransactionalQueue()
) => ({ session, db: prisma, emailQueue: queue, appUrl: TEST_APP_URL })

describe("decision emails (Postgres)", () => {
  it("TC-E9S1-04: approval queues one 'listing live' email per owner, not to staff", async () => {
    const admin = await account("ADMIN", "Admin")
    const owner1 = await account("VENDOR", "Olive")
    const owner2 = await account("VENDOR", "Mo")
    const staff = await account("VENDOR", "Sam")
    const v = await vendor([
      { userId: owner1.id, role: "OWNER" },
      { userId: owner2.id, role: "OWNER" },
      { userId: staff.id, role: "STAFF" },
    ])
    const l = await listing(v.id, "Thames Walk")
    const queue = new RecordingTransactionalQueue()

    await moderateListing(
      { listingId: l.id, action: "approve" },
      emailDeps(admin.session, queue)
    )

    const to = queue.messages.map((m) => m.to).sort()

    expect(to).toEqual([owner1.email, owner2.email].sort())
    expect(
      queue.messages.every((m) => m.tags?.kind === "listing-approved")
    ).toBe(true)
    expect(queue.messages[0]!.subject).toContain("Thames Walk")
  })

  it("TC-E9S1-04: rejection queues 'changes needed' with the reason, one per owner", async () => {
    const admin = await account("ADMIN", "Admin")
    const owner = await account("VENDOR", "Olive")
    const v = await vendor([{ userId: owner.id, role: "OWNER" }])
    const l = await listing(v.id, "Thames Walk")
    const queue = new RecordingTransactionalQueue()

    await moderateListing(
      { listingId: l.id, action: "reject", reason: "Photos are blurred" },
      emailDeps(admin.session, queue)
    )

    expect(queue.messages).toHaveLength(1)
    expect(queue.messages[0]!.tags?.kind).toBe("listing-rejected")
    expect(queue.messages[0]!.text ?? queue.messages[0]!.html).toContain(
      "Photos are blurred"
    )
  })

  it("a failing email queue rolls the decision back: still pending, no audit row", async () => {
    const admin = await account("ADMIN", "Admin")
    const owner = await account("VENDOR", "Olive")
    const v = await vendor([{ userId: owner.id, role: "OWNER" }])
    const l = await listing(v.id, "Thames Walk")

    await expect(
      moderateListing(
        { listingId: l.id, action: "approve" },
        {
          session: admin.session,
          db: prisma,
          emailQueue: brokenQueue,
          appUrl: TEST_APP_URL,
        }
      )
    ).rejects.toThrow("simulated queue outage")

    expect(
      (await prisma.listing.findUniqueOrThrow({ where: { id: l.id } })).status
    ).toBe("PENDING_REVIEW")
    expect(await prisma.auditLog.count({ where: { entityId: l.id } })).toBe(0)
  })
})

describe("the admin review queue and listing view (Postgres)", () => {
  it("shows only listings waiting for review, the longest-waiting first, with vendor eligibility", async () => {
    const admin = await account("ADMIN", "Admin")
    const owner = await account("VENDOR", "Olive")
    const ready = await vendor([{ userId: owner.id, role: "OWNER" }])
    const notOnboarded = await vendor(
      [{ userId: owner.id, role: "OWNER" }],
      "APPROVED",
      false
    )
    const first = await listing(ready.id, "First in")
    const second = await listing(notOnboarded.id, "Second in")
    await listing(ready.id, "Already live", "PUBLISHED")

    const queue = await listPendingListings({
      session: admin.session,
      db: prisma,
    })

    expect(queue.listings.map((row) => row.id)).toEqual([first.id, second.id])
    expect(queue.listings[0]!.vendor.blockReason).toBeNull()
    expect(queue.listings[1]!.vendor.blockReason).toBe("NOT_ONBOARDED")
    expect(queue.truncated).toBe(false)
  })

  it("refuses a vendor the queue and the listing view", async () => {
    const owner = await account("VENDOR", "Olive")
    const v = await vendor([{ userId: owner.id, role: "OWNER" }])
    const l = await listing(v.id, "Mine")

    await expect(
      listPendingListings({ session: owner.session, db: prisma })
    ).rejects.toThrow(ForbiddenError)
    await expect(
      getListingForReview(l.id, { session: owner.session, db: prisma })
    ).rejects.toThrow(ForbiddenError)
  })

  it("returns the listing with the decisions and reasons made so far", async () => {
    const admin = await account("ADMIN", "Admin")
    const owner = await account("VENDOR", "Olive")
    const v = await vendor([{ userId: owner.id, role: "OWNER" }])
    const l = await listing(v.id, "Thames Walk")

    await moderateListing(
      { listingId: l.id, action: "reject", reason: "Add a description" },
      emailDeps(admin.session)
    )

    const view = await getListingForReview(l.id, {
      session: admin.session,
      db: prisma,
    })

    expect(view.status).toBe("REJECTED")
    expect(view.history).toHaveLength(1)
    expect(view.history[0]!.action).toBe("listing.rejected")
    expect(view.history[0]!.meta).toMatchObject({
      reason: "Add a description",
    })
    expect(view.history[0]!.actor?.name).toBe("Admin")
  })

  it("a missing listing is not found", async () => {
    const admin = await account("ADMIN", "Admin")

    await expect(
      getListingForReview("00000000-0000-0000-0000-000000000000", {
        session: admin.session,
        db: prisma,
      })
    ).rejects.toThrow(NotFoundError)
  })
})
