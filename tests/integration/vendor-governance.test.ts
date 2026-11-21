import type { PlatformRole, PrismaClient, VendorStatus } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import type { SessionSource } from "@/lib/auth/guards"
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors"
import { transitionVendor } from "@/lib/services/vendor-governance"
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

let counter = 0
async function vendor(status: VendorStatus = "PENDING") {
  counter += 1

  return prisma.vendor.create({
    data: {
      name: `Vendor ${counter}`,
      slug: `vendor-${counter}-${Date.now()}`,
      status,
    },
  })
}

const deps = (session: SessionSource) => ({ session, db: prisma })

const auditRows = (vendorId: string) =>
  prisma.auditLog.findMany({
    where: { entityType: "Vendor", entityId: vendorId },
    orderBy: { at: "asc" },
  })

const statusOf = async (id: string) =>
  (await prisma.vendor.findUniqueOrThrow({ where: { id } })).status

describe("vendor governance on Postgres", () => {
  it("TC-E8S1-01: approving a pending vendor makes it APPROVED, records the admin and writes one audit row", async () => {
    const admin = await user("ADMIN")
    const v = await vendor("PENDING")

    const result = await transitionVendor(
      { vendorId: v.id, action: "approve" },
      deps(admin.session)
    )

    expect(result).toMatchObject({
      id: v.id,
      status: "APPROVED",
      approvedByAdminId: admin.id,
    })

    const row = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })
    expect(row.status).toBe("APPROVED")
    expect(row.approvedByAdminId).toBe(admin.id)

    const rows = await auditRows(v.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorId: admin.id,
      action: "vendor.approved",
      entityType: "Vendor",
      entityId: v.id,
      meta: { from: "PENDING", to: "APPROVED" },
    })
  })

  it("TC-E8S1-03: suspend then reinstate returns the vendor to APPROVED, with one audit row each and the original approver kept", async () => {
    const admin = await user("ADMIN")
    const other = await user("ADMIN")
    const v = await vendor("PENDING")

    await transitionVendor(
      { vendorId: v.id, action: "approve" },
      deps(admin.session)
    )
    await transitionVendor(
      { vendorId: v.id, action: "suspend", reason: "Chargeback spike" },
      deps(other.session)
    )
    expect(await statusOf(v.id)).toBe("SUSPENDED")

    await transitionVendor(
      { vendorId: v.id, action: "reinstate" },
      deps(other.session)
    )

    const row = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })
    expect(row.status).toBe("APPROVED")
    expect(row.approvedByAdminId).toBe(admin.id)

    expect((await auditRows(v.id)).map((r) => [r.action, r.actorId])).toEqual([
      ["vendor.approved", admin.id],
      ["vendor.suspended", other.id],
      ["vendor.reinstated", other.id],
    ])
  })

  it("TC-E8S1-04: a vendor or tourist cannot approve, and nothing changes", async () => {
    const v = await vendor("PENDING")

    for (const role of ["VENDOR", "TOURIST"] as const) {
      const caller = await user(role)

      await expect(
        transitionVendor(
          { vendorId: v.id, action: "approve" },
          deps(caller.session)
        )
      ).rejects.toBeInstanceOf(ForbiddenError)
    }

    expect(await statusOf(v.id)).toBe("PENDING")
    expect(await prisma.auditLog.count()).toBe(0)
  })

  it("TC-E8S1-17: rejecting stores the trimmed reason in the audit row and does not set an approver", async () => {
    const admin = await user("ADMIN")
    const v = await vendor("PENDING")

    await transitionVendor(
      { vendorId: v.id, action: "reject", reason: "  No trading licence " },
      deps(admin.session)
    )

    const row = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })
    expect(row).toMatchObject({ status: "REJECTED", approvedByAdminId: null })
    expect((await auditRows(v.id))[0]?.meta).toEqual({
      from: "PENDING",
      to: "REJECTED",
      reason: "No trading licence",
    })
  })

  it("TC-E8S1-18: illegal transitions throw Conflict and leave the vendor and the audit log untouched", async () => {
    const admin = await user("ADMIN")
    const cases: Array<
      [VendorStatus, "approve" | "reject" | "suspend" | "reinstate"]
    > = [
      ["APPROVED", "approve"],
      ["APPROVED", "reject"],
      ["PENDING", "suspend"],
      ["PENDING", "reinstate"],
      ["REJECTED", "approve"],
      ["REJECTED", "reinstate"],
      ["SUSPENDED", "approve"],
      ["SUSPENDED", "suspend"],
    ]

    for (const [status, action] of cases) {
      const v = await vendor(status)

      await expect(
        transitionVendor(
          { vendorId: v.id, action, reason: "because" },
          deps(admin.session)
        ),
        `${status} ${action}`
      ).rejects.toBeInstanceOf(ConflictError)

      expect(await statusOf(v.id)).toBe(status)
      expect(await auditRows(v.id)).toHaveLength(0)
    }
  })

  it("TC-E8S1-19: the status change and its audit row are atomic: if the audit write fails, nothing is changed", async () => {
    const admin = await user("ADMIN")
    const v = await vendor("PENDING")

    await expect(
      transitionVendor(
        { vendorId: v.id, action: "approve" },
        {
          ...deps(admin.session),
          record: async () => {
            throw new Error("audit write failed")
          },
        }
      )
    ).rejects.toThrow("audit write failed")

    const row = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })
    expect(row).toMatchObject({ status: "PENDING", approvedByAdminId: null })
    expect(await auditRows(v.id)).toHaveLength(0)
  })

  it("TC-E8S1-20: two admins acting on the same pending vendor at once: exactly one wins, the other gets Conflict, one audit row", async () => {
    const a = await user("ADMIN")
    const b = await user("ADMIN")
    const v = await vendor("PENDING")

    const results = await Promise.allSettled([
      transitionVendor({ vendorId: v.id, action: "approve" }, deps(a.session)),
      transitionVendor(
        { vendorId: v.id, action: "reject", reason: "Duplicate" },
        deps(b.session)
      ),
    ])

    const fulfilled = results.filter((r) => r.status === "fulfilled")
    const rejected = results.filter((r) => r.status === "rejected")

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictError
    )

    const rows = await auditRows(v.id)
    expect(rows).toHaveLength(1)
    expect(["APPROVED", "REJECTED"]).toContain(await statusOf(v.id))
    expect(rows[0]?.meta).toMatchObject({ to: await statusOf(v.id) })
  })

  it("TC-E8S1-21: an unknown vendor id is a NotFoundError", async () => {
    const admin = await user("ADMIN")

    await expect(
      transitionVendor(
        { vendorId: "no-such-vendor", action: "approve" },
        deps(admin.session)
      )
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("TC-E8S1-22: the audit trail survives the deletion of the admin who acted (actor becomes null)", async () => {
    const admin = await user("ADMIN")
    const v = await vendor("PENDING")

    await transitionVendor(
      { vendorId: v.id, action: "approve" },
      deps(admin.session)
    )
    await prisma.user.delete({ where: { id: admin.id } })

    const rows = await auditRows(v.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actorId: null, action: "vendor.approved" })
  })
})
