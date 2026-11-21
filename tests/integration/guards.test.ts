import type { PlatformRole, PrismaClient, VendorRole } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import {
  prismaMembershipStore,
  requireAdmin,
  requireRole,
  requireVendorMember,
  type SessionSource,
} from "@/lib/auth/guards"
import { ForbiddenError } from "@/lib/errors"
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

async function user(platformRole: PlatformRole = "TOURIST") {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole },
  })

  return { id: row.id, session: await h.sessionFor(email, password) }
}

async function vendor(slug: string) {
  return prisma.vendor.create({
    data: { name: `Vendor ${slug}`, slug, status: "APPROVED" },
  })
}

async function member(userId: string, vendorId: string, role: VendorRole) {
  await prisma.vendorMember.create({ data: { userId, vendorId, role } })
}

const deps = (session: SessionSource) => ({
  session,
  memberships: prismaMembershipStore(prisma),
})

describe("role guards with real sessions", () => {
  it("TC-E0S3-17: platform roles are read from the database through a real session", async () => {
    const admin = await user("ADMIN")
    const vendorUser = await user("VENDOR")
    const tourist = await user("TOURIST")

    expect((await requireAdmin(admin.session)).id).toBe(admin.id)
    expect((await requireRole("VENDOR", vendorUser.session)).id).toBe(
      vendorUser.id
    )
    await expect(requireAdmin(vendorUser.session)).rejects.toMatchObject({
      status: 403,
    })
    await expect(requireRole("VENDOR", tourist.session)).rejects.toMatchObject({
      status: 403,
    })
  })

  it("TC-E0S3-18: a role change takes effect on the next request, with no re-login", async () => {
    const promoted = await user("TOURIST")

    await expect(requireAdmin(promoted.session)).rejects.toBeInstanceOf(
      ForbiddenError
    )

    await prisma.user.update({
      where: { id: promoted.id },
      data: { platformRole: "ADMIN" },
    })

    expect((await requireAdmin(promoted.session)).platformRole).toBe("ADMIN")
  })
})

describe("vendor membership guard on Postgres", () => {
  it("TC-E0S3-03: staff of vendor X are denied vendor Y and allowed vendor X (CR-2)", async () => {
    const [x, y] = [await vendor("x"), await vendor("y")]
    const staff = await user("VENDOR")
    await member(staff.id, x.id, "STAFF")

    expect(
      (await requireVendorMember(x.id, undefined, deps(staff.session))).vendorId
    ).toBe(x.id)
    await expect(
      requireVendorMember(y.id, undefined, deps(staff.session))
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" })
  })

  it("TC-E0S3-19: owner-only work is denied to staff and allowed to the owner", async () => {
    const x = await vendor("x")
    const owner = await user("VENDOR")
    const staff = await user("VENDOR")
    await member(owner.id, x.id, "OWNER")
    await member(staff.id, x.id, "STAFF")

    expect(
      (await requireVendorMember(x.id, ["OWNER"], deps(owner.session)))
        .vendorRole
    ).toBe("OWNER")
    await expect(
      requireVendorMember(x.id, ["OWNER"], deps(staff.session))
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("TC-E0S3-20: removing the membership revokes access immediately", async () => {
    const x = await vendor("x")
    const staff = await user("VENDOR")
    await member(staff.id, x.id, "STAFF")

    await requireVendorMember(x.id, undefined, deps(staff.session))
    await prisma.vendorMember.deleteMany({ where: { userId: staff.id } })

    await expect(
      requireVendorMember(x.id, undefined, deps(staff.session))
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("TC-E0S3-21: a platform ADMIN who is not a member is still denied vendor-scoped access", async () => {
    const x = await vendor("x")
    const admin = await user("ADMIN")

    await expect(
      requireVendorMember(x.id, undefined, deps(admin.session))
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("TC-E0S3-22: an unknown vendor id gives the same denial as someone else's vendor", async () => {
    const x = await vendor("x")
    const outsider = await user("VENDOR")
    const owner = await user("VENDOR")
    await member(owner.id, x.id, "OWNER")

    const [someoneElses, missing] = await Promise.all([
      requireVendorMember(x.id, undefined, deps(outsider.session)).catch(
        (e) => e
      ),
      requireVendorMember(
        "no-such-vendor",
        undefined,
        deps(outsider.session)
      ).catch((e) => e),
    ])

    expect(someoneElses).toBeInstanceOf(ForbiddenError)
    expect(missing).toBeInstanceOf(ForbiddenError)
    expect(missing.message).toBe(someoneElses.message)
  })
})
