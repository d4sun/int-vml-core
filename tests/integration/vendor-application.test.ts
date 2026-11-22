import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import type { SessionSource } from "@/lib/auth/guards"
import { authorizeSurface } from "@/lib/auth/surface"
import { assertVendorCanSell } from "@/lib/catalog/visibility"
import { ConflictError, ForbiddenError } from "@/lib/errors"
import { applyAsVendor } from "@/lib/services/vendor-application"
import { listVendorsForAdmin } from "@/lib/services/vendor-admin"
import { transitionVendor } from "@/lib/services/vendor-governance"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"
import { governanceDeps } from "../helpers/recording-transactional-queue"

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

async function account(platformRole: PlatformRole = "TOURIST", name = "Olive") {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole, name },
  })

  return { id: row.id, email, session: await h.sessionFor(email, password) }
}

const deps = (session: SessionSource) => ({ session, db: prisma })
const roleOf = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).platformRole

describe("applying to become a vendor (Postgres)", () => {
  it("TC-E4S1-01: applying creates a PENDING vendor with the caller as its OWNER, and records it", async () => {
    const olive = await account("TOURIST", "Olive Owner")

    const applied = await applyAsVendor(
      { name: "Thames Tours", description: "Walking tours of the South Bank." },
      deps(olive.session)
    )

    expect(applied).toMatchObject({ name: "Thames Tours", status: "PENDING" })
    expect(applied.slug).toMatch(/^thames-tours-[a-z0-9]{6}$/)

    const vendor = await prisma.vendor.findUniqueOrThrow({
      where: { id: applied.id },
      include: { members: true },
    })

    expect(vendor).toMatchObject({
      status: "PENDING",
      description: "Walking tours of the South Bank.",
      contactEmail: olive.email,
      stripeOnboardingComplete: false,
      approvedByAdminId: null,
    })
    expect(vendor.members).toHaveLength(1)
    expect(vendor.members[0]).toMatchObject({ userId: olive.id, role: "OWNER" })

    const audit = await prisma.auditLog.findMany({
      where: { entityId: applied.id },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      actorId: olive.id,
      action: "vendor.applied",
      entityType: "Vendor",
      meta: { name: "Thames Tours" },
    })
  })

  it("TC-E4S1-23: a given contact email wins over the account email", async () => {
    const olive = await account()

    const applied = await applyAsVendor(
      { name: "Thames Tours", contactEmail: "Hello@Thames.Example" },
      deps(olive.session)
    )

    expect(
      (await prisma.vendor.findUniqueOrThrow({ where: { id: applied.id } }))
        .contactEmail
    ).toBe("hello@thames.example")
  })

  it("TC-E4S1-02: a second application while one is open is a Conflict and creates nothing", async () => {
    const olive = await account()

    await applyAsVendor({ name: "Thames Tours" }, deps(olive.session))

    await expect(
      applyAsVendor({ name: "Another Business" }, deps(olive.session))
    ).rejects.toBeInstanceOf(ConflictError)

    expect(await prisma.vendor.count()).toBe(1)
    expect(await prisma.vendorMember.count()).toBe(1)
    expect(await prisma.auditLog.count()).toBe(1)
  })

  it("TC-E4S1-16: two simultaneous applications from one person: exactly one is created", async () => {
    const olive = await account()

    const results = await Promise.allSettled([
      applyAsVendor({ name: "Thames Tours" }, deps(olive.session)),
      applyAsVendor({ name: "Thames Tours" }, deps(olive.session)),
    ])

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find(
      (r) => r.status === "rejected"
    ) as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(ConflictError)
    expect(await prisma.vendor.count()).toBe(1)
  })

  it("TC-E4S1-24: the limit is per person: other people can apply, even with the same business name", async () => {
    const a = await account()
    const b = await account()

    const first = await applyAsVendor({ name: "Thames Tours" }, deps(a.session))
    const second = await applyAsVendor(
      { name: "Thames Tours" },
      deps(b.session)
    )

    expect(first.slug).not.toBe(second.slug)
    expect(await prisma.vendor.count()).toBe(2)
  })

  it("TC-E4S1-17: after a rejection the applicant can apply again, as a new vendor", async () => {
    const admin = await account("ADMIN", "Admin")
    const olive = await account()

    const first = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )
    await transitionVendor(
      { vendorId: first.id, action: "reject", reason: "No licence" },
      governanceDeps(admin.session, prisma)
    )

    const second = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )

    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe("PENDING")
    expect(
      (await prisma.vendor.findUniqueOrThrow({ where: { id: first.id } }))
        .status
    ).toBe("REJECTED")
  })

  it("TC-E4S1-25: slug collisions are retried with a new suffix", async () => {
    const a = await account()
    const b = await account()
    let calls = 0
    const sequence = ["aaaaaa", "aaaaaa", "bbbbbb"]
    const randomSuffix = () => sequence[calls++] ?? `zzz${calls}`

    const first = await applyAsVendor(
      { name: "Thames Tours" },
      { ...deps(a.session), randomSuffix }
    )
    const second = await applyAsVendor(
      { name: "Thames Tours" },
      { ...deps(b.session), randomSuffix }
    )

    expect(first.slug).toBe("thames-tours-aaaaaa")
    expect(second.slug).toBe("thames-tours-bbbbbb")
  })

  it("TC-E4S1-26: if the audit write fails nothing is created (the application is atomic)", async () => {
    const olive = await account()

    await expect(
      applyAsVendor(
        { name: "Thames Tours" },
        {
          ...deps(olive.session),
          record: async () => {
            throw new Error("audit write failed")
          },
        }
      )
    ).rejects.toThrow("audit write failed")

    expect(await prisma.vendor.count()).toBe(0)
    expect(await prisma.vendorMember.count()).toBe(0)
  })

  it("TC-E4S1-21: an administrator is refused and nothing is written", async () => {
    const admin = await account("ADMIN")

    await expect(
      applyAsVendor({ name: "Thames Tours" }, deps(admin.session))
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(await prisma.vendor.count()).toBe(0)
  })
})

describe("what an application grants (Postgres)", () => {
  it("TC-E4S1-03: a pending vendor cannot sell or be paid", async () => {
    const olive = await account()
    const applied = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )

    const error = await assertVendorCanSell(applied.id, prisma).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ForbiddenError)
    expect((error as ForbiddenError).details).toEqual({
      reason: "NOT_APPROVED",
    })
  })

  it("TC-E4S1-04: the applicant's role does not change on apply or on rejection, and becomes VENDOR only on approval", async () => {
    const admin = await account("ADMIN", "Admin")
    const olive = await account("TOURIST", "Olive")
    const rejected = await account("TOURIST", "Rita")

    const pending = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )
    expect(await roleOf(olive.id)).toBe("TOURIST")

    const turnedAway = await applyAsVendor(
      { name: "Rita's Rides" },
      deps(rejected.session)
    )
    await transitionVendor(
      { vendorId: turnedAway.id, action: "reject", reason: "No licence" },
      governanceDeps(admin.session, prisma)
    )
    expect(await roleOf(rejected.id)).toBe("TOURIST")

    await transitionVendor(
      { vendorId: pending.id, action: "approve" },
      governanceDeps(admin.session, prisma)
    )
    expect(await roleOf(olive.id)).toBe("VENDOR")

    // Who was promoted is on the record.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: pending.id, action: "vendor.approved" },
    })
    expect(audit.meta).toMatchObject({ promotedUserIds: [olive.id] })
  })

  it("TC-E4S1-27: approval does not touch an admin who owns a vendor, and a later approval of an existing VENDOR promotes nobody", async () => {
    const admin = await account("ADMIN", "Admin")
    const owner = await account("ADMIN", "Owner Admin")
    const vendorOwner = await account("VENDOR", "Vera")

    const adminOwned = await prisma.vendor.create({
      data: {
        name: "Admin Owned",
        slug: "admin-owned",
        status: "PENDING",
        members: { create: { userId: owner.id, role: "OWNER" } },
      },
    })
    const second = await prisma.vendor.create({
      data: {
        name: "Second Shop",
        slug: "second-shop",
        status: "PENDING",
        members: { create: { userId: vendorOwner.id, role: "OWNER" } },
      },
    })

    for (const vendor of [adminOwned, second]) {
      await transitionVendor(
        { vendorId: vendor.id, action: "approve" },
        governanceDeps(admin.session, prisma)
      )

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: vendor.id, action: "vendor.approved" },
      })
      expect(audit.meta).not.toHaveProperty("promotedUserIds")
    }

    expect(await roleOf(owner.id)).toBe("ADMIN")
    expect(await roleOf(vendorOwner.id)).toBe("VENDOR")
  })

  it("TC-E4S1-28: suspending or reinstating does not change anyone's role", async () => {
    const admin = await account("ADMIN", "Admin")
    const olive = await account()
    const applied = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )
    const gov = governanceDeps(admin.session, prisma)

    await transitionVendor({ vendorId: applied.id, action: "approve" }, gov)
    await transitionVendor(
      { vendorId: applied.id, action: "suspend", reason: "Spike" },
      gov
    )
    expect(await roleOf(olive.id)).toBe("VENDOR")
    await transitionVendor({ vendorId: applied.id, action: "reinstate" }, gov)
    expect(await roleOf(olive.id)).toBe("VENDOR")
  })

  it("TC-E4S1-29: access follows approval: the vendor area is closed before it and open after, with no re-login", async () => {
    const admin = await account("ADMIN", "Admin")
    const olive = await account()

    const applied = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )

    expect(
      (await authorizeSurface("vendor", "/vendor", olive.session)).action
    ).toBe("deny")

    await transitionVendor(
      { vendorId: applied.id, action: "approve" },
      governanceDeps(admin.session, prisma)
    )

    expect(
      (await authorizeSurface("vendor", "/vendor", olive.session)).action
    ).toBe("allow")
  })

  it("TC-E4S1-30: the application appears in the admin review queue with its applicant", async () => {
    const admin = await account("ADMIN", "Admin")
    const olive = await account("TOURIST", "Olive Owner")

    const applied = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )
    const queue = await listVendorsForAdmin(
      { status: "PENDING" },
      deps(admin.session)
    )

    expect(queue.vendors).toHaveLength(1)
    expect(queue.vendors[0]).toMatchObject({
      id: applied.id,
      owner: { name: "Olive Owner", email: olive.email },
    })
    expect(queue.counts.PENDING).toBe(1)
  })
})
