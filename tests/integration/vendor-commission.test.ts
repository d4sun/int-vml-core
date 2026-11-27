import type { PrismaClient, PlatformRole } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { ForbiddenError, NotFoundError } from "@/lib/errors"
import { getVendorForAdmin } from "@/lib/services/vendor-admin"
import { setVendorCommission } from "@/lib/services/vendor-commission"
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

async function account(platformRole: PlatformRole, name: string) {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole, name },
  })

  return { id: row.id, session: await h.sessionFor(email, password) }
}

let n = 0
async function vendor(commissionBpsOverride: number | null = null) {
  n += 1

  return prisma.vendor.create({
    data: {
      name: `Vendor ${n}`,
      slug: `vendor-${n}`,
      status: "APPROVED",
      commissionBpsOverride,
    },
  })
}

const commissionOf = async (id: string) =>
  (await prisma.vendor.findUniqueOrThrow({ where: { id } }))
    .commissionBpsOverride

describe("vendor commission (Postgres)", () => {
  it("an admin sets a vendor's commission; it is stored and shown on the admin view", async () => {
    const admin = await account("ADMIN", "Admin")
    const v = await vendor()

    const result = await setVendorCommission(
      { vendorId: v.id, commissionBps: 1250 },
      { session: admin.session, db: prisma }
    )

    expect(result.commissionBpsOverride).toBe(1250)
    expect(await commissionOf(v.id)).toBe(1250)
    const view = await getVendorForAdmin(v.id, {
      session: admin.session,
      db: prisma,
    })
    expect(view.commissionBpsOverride).toBe(1250)
  })

  it("the change is audited with who made it and the old and new values", async () => {
    const admin = await account("ADMIN", "Admin")
    const v = await vendor(1000)

    await setVendorCommission(
      { vendorId: v.id, commissionBps: 1500 },
      { session: admin.session, db: prisma }
    )

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: v.id, action: "vendor.commission_changed" },
    })
    expect(row.actorId).toBe(admin.id)
    expect(row.meta).toMatchObject({ from: 1000, to: 1500 })
  })

  it("clearing the override (null) makes the vendor use each category's default again", async () => {
    const admin = await account("ADMIN", "Admin")
    const v = await vendor(1250)

    await setVendorCommission(
      { vendorId: v.id, commissionBps: null },
      { session: admin.session, db: prisma }
    )

    expect(await commissionOf(v.id)).toBeNull()
  })

  it("setting the value it already has changes nothing and writes no audit row", async () => {
    const admin = await account("ADMIN", "Admin")
    const v = await vendor(1250)

    await setVendorCommission(
      { vendorId: v.id, commissionBps: 1250 },
      { session: admin.session, db: prisma }
    )

    expect(await prisma.auditLog.count({ where: { entityId: v.id } })).toBe(0)
  })

  it("a vendor cannot set its own commission, and nothing changes", async () => {
    const owner = await account("VENDOR", "Olive")
    const v = await vendor(1000)
    await prisma.vendorMember.create({
      data: { userId: owner.id, vendorId: v.id, role: "OWNER" },
    })

    await expect(
      setVendorCommission(
        { vendorId: v.id, commissionBps: 0 },
        { session: owner.session, db: prisma }
      )
    ).rejects.toThrow(ForbiddenError)
    expect(await commissionOf(v.id)).toBe(1000)
  })

  it("an unknown vendor is not found", async () => {
    const admin = await account("ADMIN", "Admin")

    await expect(
      setVendorCommission(
        {
          vendorId: "00000000-0000-0000-0000-000000000000",
          commissionBps: 1000,
        },
        { session: admin.session, db: prisma }
      )
    ).rejects.toThrow(NotFoundError)
  })
})
