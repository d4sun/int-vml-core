import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import type { SessionSource } from "@/lib/auth/guards"
import {
  applyAsVendor,
  getApplicationStatus,
} from "@/lib/services/vendor-application"
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

describe("application status on Postgres", () => {
  it("TC-E4S1-42: someone who has not applied has nothing to show, and can apply", async () => {
    const olive = await account()

    expect(await getApplicationStatus(deps(olive.session))).toEqual({
      email: olive.email,
      canApply: true,
      application: null,
    })
  })

  it("TC-E4S1-43: after applying, the application is shown as PENDING with its name and no reason", async () => {
    const olive = await account()
    const applied = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )

    const { application } = await getApplicationStatus(deps(olive.session))

    expect(application).toMatchObject({
      id: applied.id,
      name: "Thames Tours",
      status: "PENDING",
      reason: null,
    })
  })

  it("TC-E4S1-44: a rejection shows its reason, and a fresh application then takes over as PENDING", async () => {
    const admin = await account("ADMIN", "Admin")
    const olive = await account()

    const first = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )
    await transitionVendor(
      { vendorId: first.id, action: "reject", reason: "No trading licence" },
      governanceDeps(admin.session, prisma)
    )

    expect(
      (await getApplicationStatus(deps(olive.session))).application
    ).toMatchObject({
      id: first.id,
      status: "REJECTED",
      reason: "No trading licence",
    })

    const second = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )

    expect(
      (await getApplicationStatus(deps(olive.session))).application
    ).toMatchObject({
      id: second.id,
      status: "PENDING",
      reason: null,
    })
  })

  it("TC-E4S1-45: approval, suspension and reinstatement are each reflected, with the suspension's reason only while suspended", async () => {
    const admin = await account("ADMIN", "Admin")
    const olive = await account()
    const gov = governanceDeps(admin.session, prisma)
    const applied = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )

    await transitionVendor({ vendorId: applied.id, action: "approve" }, gov)
    expect(
      (await getApplicationStatus(deps(olive.session))).application
    ).toMatchObject({
      status: "APPROVED",
      reason: null,
    })

    await transitionVendor(
      { vendorId: applied.id, action: "suspend", reason: "Chargeback spike" },
      gov
    )
    expect(
      (await getApplicationStatus(deps(olive.session))).application
    ).toMatchObject({
      status: "SUSPENDED",
      reason: "Chargeback spike",
    })

    await transitionVendor({ vendorId: applied.id, action: "reinstate" }, gov)
    expect(
      (await getApplicationStatus(deps(olive.session))).application
    ).toMatchObject({
      status: "APPROVED",
      reason: null,
    })
  })

  it("TC-E4S1-46: when suspended twice, the latest reason is shown", async () => {
    const admin = await account("ADMIN", "Admin")
    const olive = await account()
    const gov = governanceDeps(admin.session, prisma)
    const applied = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )

    await transitionVendor({ vendorId: applied.id, action: "approve" }, gov)
    await transitionVendor(
      { vendorId: applied.id, action: "suspend", reason: "First reason" },
      gov
    )
    await transitionVendor({ vendorId: applied.id, action: "reinstate" }, gov)
    await transitionVendor(
      { vendorId: applied.id, action: "suspend", reason: "Second reason" },
      gov
    )

    expect(
      (await getApplicationStatus(deps(olive.session))).application?.reason
    ).toBe("Second reason")
  })

  it("TC-E4S1-47: people only ever see their own vendors, and staff membership is not an application", async () => {
    const olive = await account("TOURIST", "Olive")
    const stranger = await account("TOURIST", "Stranger")
    const staff = await account("VENDOR", "Sam Staff")

    await applyAsVendor({ name: "Olive's Tours" }, deps(olive.session))
    const strangers = await applyAsVendor(
      { name: "Stranger Shop" },
      deps(stranger.session)
    )
    await prisma.vendorMember.create({
      data: { userId: staff.id, vendorId: strangers.id, role: "STAFF" },
    })

    expect(
      (await getApplicationStatus(deps(olive.session))).application?.name
    ).toBe("Olive's Tours")
    expect(
      (await getApplicationStatus(deps(stranger.session))).application?.name
    ).toBe("Stranger Shop")
    expect(
      (await getApplicationStatus(deps(staff.session))).application
    ).toBeNull()
  })

  it("TC-E4S1-48: an administrator sees that they cannot apply", async () => {
    const admin = await account("ADMIN", "Admin")

    expect(await getApplicationStatus(deps(admin.session))).toMatchObject({
      canApply: false,
      application: null,
    })
  })
})
