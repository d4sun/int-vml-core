import type { PlatformRole, PrismaClient, VendorStatus } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import type { SessionSource } from "@/lib/auth/guards"
import { ForbiddenError, NotFoundError } from "@/lib/errors"
import {
  ADMIN_VENDOR_LIST_LIMIT,
  getVendorForAdmin,
  listVendorsForAdmin,
} from "@/lib/services/vendor-admin"
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

async function user(platformRole: PlatformRole, name = "Someone") {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole, name },
  })

  return { id: row.id, email, session: await h.sessionFor(email, password) }
}

let counter = 0
async function vendor(
  status: VendorStatus,
  extra: { createdAt?: Date; name?: string } = {}
) {
  counter += 1

  return prisma.vendor.create({
    data: {
      name: extra.name ?? `Vendor ${counter}`,
      slug: `vendor-${counter}-${Date.now()}`,
      status,
      ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
    },
  })
}

const deps = (session: SessionSource) => ({ session, db: prisma })

describe("admin vendor queue on Postgres", () => {
  it("TC-E8S1-44: lists oldest first, filters by status, and counts every status", async () => {
    const admin = await user("ADMIN")
    const newest = await vendor("PENDING", {
      createdAt: new Date("2026-03-03"),
    })
    const oldest = await vendor("PENDING", {
      createdAt: new Date("2026-03-01"),
    })
    const middle = await vendor("PENDING", {
      createdAt: new Date("2026-03-02"),
    })
    await vendor("APPROVED")
    await vendor("APPROVED")
    await vendor("SUSPENDED")

    const pending = await listVendorsForAdmin(
      { status: "PENDING" },
      deps(admin.session)
    )

    expect(pending.vendors.map((v) => v.id)).toEqual([
      oldest.id,
      middle.id,
      newest.id,
    ])
    expect(pending.counts).toEqual({
      PENDING: 3,
      APPROVED: 2,
      SUSPENDED: 1,
      REJECTED: 0,
    })
    expect(pending.truncated).toBe(false)

    const all = await listVendorsForAdmin({}, deps(admin.session))
    expect(all.vendors).toHaveLength(6)

    const approved = await listVendorsForAdmin(
      { status: "APPROVED" },
      deps(admin.session)
    )
    expect(approved.vendors.every((v) => v.status === "APPROVED")).toBe(true)
    expect(approved.vendors).toHaveLength(2)
  })

  it("TC-E8S1-45: each row carries the applicant (the owner) and the listing count", async () => {
    const admin = await user("ADMIN")
    const owner = await user("VENDOR", "Olive Owner")
    const staff = await user("VENDOR", "Sam Staff")
    const v = await vendor("PENDING")

    await prisma.vendorMember.createMany({
      data: [
        { userId: staff.id, vendorId: v.id, role: "STAFF" },
        { userId: owner.id, vendorId: v.id, role: "OWNER" },
      ],
    })
    const category = await prisma.category.create({
      data: { name: "Tours", slug: "tours", type: "TIMED_SLOT" },
    })
    await prisma.listing.createMany({
      data: [1, 2].map((n) => ({
        vendorId: v.id,
        categoryId: category.id,
        title: `L${n}`,
        slug: `l${n}`,
      })),
    })

    const { vendors } = await listVendorsForAdmin({}, deps(admin.session))

    expect(vendors).toHaveLength(1)
    expect(vendors[0]).toMatchObject({
      owner: { name: "Olive Owner", email: owner.email },
      listingCount: 2,
    })
  })

  it("TC-E8S1-46: with no owner there is no applicant: a vendor with no members, or only staff, lists with owner null", async () => {
    const admin = await user("ADMIN")
    const staff = await user("VENDOR", "Sam Staff")
    await vendor("PENDING", {
      name: "No members",
      createdAt: new Date("2026-03-01"),
    })
    const staffOnly = await vendor("PENDING", {
      name: "Staff only",
      createdAt: new Date("2026-03-02"),
    })
    await prisma.vendorMember.create({
      data: { userId: staff.id, vendorId: staffOnly.id, role: "STAFF" },
    })

    const { vendors } = await listVendorsForAdmin({}, deps(admin.session))

    expect(vendors.map((v) => [v.name, v.owner])).toEqual([
      ["No members", null],
      ["Staff only", null],
    ])
  })

  it("TC-E8S1-47: the list is capped, and says so when there are more", async () => {
    const admin = await user("ADMIN")
    const base = new Date("2026-01-01T00:00:00Z").getTime()

    await prisma.vendor.createMany({
      data: Array.from({ length: ADMIN_VENDOR_LIST_LIMIT + 1 }, (_, i) => ({
        name: `Bulk ${i}`,
        slug: `bulk-${i}`,
        status: "PENDING" as const,
        createdAt: new Date(base + i * 1000),
      })),
    })

    const result = await listVendorsForAdmin(
      { status: "PENDING" },
      deps(admin.session)
    )

    expect(result.vendors).toHaveLength(ADMIN_VENDOR_LIST_LIMIT)
    expect(result.truncated).toBe(true)
    expect(result.vendors[0]?.name).toBe("Bulk 0")
    expect(result.counts.PENDING).toBe(ADMIN_VENDOR_LIST_LIMIT + 1)
  })

  it("TC-E8S1-48: only admins can read the queue", async () => {
    await vendor("PENDING")

    for (const role of ["VENDOR", "TOURIST"] as const) {
      const caller = await user(role)

      await expect(
        listVendorsForAdmin({}, deps(caller.session))
      ).rejects.toBeInstanceOf(ForbiddenError)
    }
  })
})

describe("admin vendor detail on Postgres", () => {
  it("TC-E8S1-49: shows the team, listing count and the audit history newest first, with reasons and actors", async () => {
    const first = await user("ADMIN", "First Admin")
    const second = await user("ADMIN", "Second Admin")
    const owner = await user("VENDOR", "Olive Owner")
    const v = await vendor("PENDING", { name: "Thames Tours" })
    await prisma.vendorMember.create({
      data: { userId: owner.id, vendorId: v.id, role: "OWNER" },
    })

    await transitionVendor(
      { vendorId: v.id, action: "approve" },
      governanceDeps(first.session, prisma)
    )
    await transitionVendor(
      { vendorId: v.id, action: "suspend", reason: "Chargeback spike" },
      governanceDeps(second.session, prisma)
    )

    const detail = await getVendorForAdmin(v.id, deps(first.session))

    expect(detail).toMatchObject({
      id: v.id,
      name: "Thames Tours",
      status: "SUSPENDED",
      approvedByAdminId: first.id,
      listingCount: 0,
      members: [{ role: "OWNER", name: "Olive Owner", email: owner.email }],
    })
    expect(detail.audit.map((a) => a.action)).toEqual([
      "vendor.suspended",
      "vendor.approved",
    ])
    expect(detail.audit[0]).toMatchObject({
      actor: { name: "Second Admin" },
      meta: { from: "APPROVED", to: "SUSPENDED", reason: "Chargeback spike" },
    })
  })

  it("TC-E8S1-50: audit rows whose admin was deleted still show, with no actor", async () => {
    const gone = await user("ADMIN")
    const reader = await user("ADMIN")
    const v = await vendor("PENDING")

    await transitionVendor(
      { vendorId: v.id, action: "approve" },
      governanceDeps(gone.session, prisma)
    )
    await prisma.user.delete({ where: { id: gone.id } })

    const detail = await getVendorForAdmin(v.id, deps(reader.session))

    expect(detail.audit).toHaveLength(1)
    expect(detail.audit[0]?.actor).toBeNull()
  })

  it("TC-E8S1-51: an unknown vendor is a NotFoundError, and a non-admin is refused first", async () => {
    const admin = await user("ADMIN")
    const outsider = await user("VENDOR")
    const v = await vendor("PENDING")

    await expect(
      getVendorForAdmin("no-such-vendor", deps(admin.session))
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      getVendorForAdmin(v.id, deps(outsider.session))
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
