import type { VendorStatus } from "@prisma/client"
import { describe, expect, it } from "vitest"
import type { SessionSource } from "@/lib/auth/guards"
import {
  getApplicationStatus,
  pickApplication,
} from "@/lib/services/vendor-application"

const v = (status: VendorStatus, day: number, id = `${status}-${day}`) => ({
  id,
  status,
  createdAt: new Date(`2026-03-${String(day).padStart(2, "0")}T10:00:00Z`),
})

describe("pickApplication", () => {
  it("TC-E4S1-33: nothing owned means nothing to show", () => {
    expect(pickApplication([])).toBeNull()
  })

  it("TC-E4S1-34: a vendor under review wins, even over a newer one", () => {
    const picked = pickApplication([
      v("APPROVED", 9),
      v("PENDING", 5),
      v("REJECTED", 2),
    ])

    expect(picked?.id).toBe("PENDING-5")
  })

  it("TC-E4S1-35: otherwise the most recent wins, whatever the order it was given in", () => {
    const owned = [v("REJECTED", 2), v("APPROVED", 9), v("SUSPENDED", 5)]

    expect(pickApplication(owned)?.id).toBe("APPROVED-9")
    expect(pickApplication([...owned].reverse())?.id).toBe("APPROVED-9")
  })
})

const as =
  (platformRole: string | null): SessionSource =>
  async () =>
    platformRole
      ? {
          user: {
            id: "u1",
            email: "olive@example.com",
            name: "Olive",
            emailVerified: true,
            platformRole,
          },
        }
      : null

function fakeDb(
  owned: Array<{
    id: string
    name: string
    status: VendorStatus
    createdAt: Date
  }>,
  meta: unknown = { reason: "No licence" }
) {
  const calls = { vendor: [] as unknown[], audit: [] as unknown[] }

  return {
    calls,
    db: {
      vendor: {
        findMany: async (args: unknown) => {
          calls.vendor.push(args)
          return owned
        },
      },
      auditLog: {
        findFirst: async (args: unknown) => {
          calls.audit.push(args)
          return { meta }
        },
      },
    } as never,
  }
}

const vendor = (status: VendorStatus) => ({
  id: "v1",
  name: "Thames Tours",
  status,
  createdAt: new Date("2026-03-01T10:00:00Z"),
})

describe("getApplicationStatus", () => {
  it("TC-E4S1-36: signed out is a 401 and nothing is read", async () => {
    const { db, calls } = fakeDb([])

    await expect(
      getApplicationStatus({ session: as(null), db })
    ).rejects.toMatchObject({ status: 401 })
    expect(calls.vendor).toHaveLength(0)
  })

  it("TC-E4S1-37: it only looks at vendors the caller OWNS, by the caller's own id", async () => {
    const { db, calls } = fakeDb([])

    await getApplicationStatus({ session: as("TOURIST"), db })

    expect(calls.vendor[0]).toMatchObject({
      where: { members: { some: { userId: "u1", role: "OWNER" } } },
    })
  })

  it("TC-E4S1-38: no application: a tourist can apply, an administrator cannot, and the account email is returned", async () => {
    const { db } = fakeDb([])

    expect(await getApplicationStatus({ session: as("TOURIST"), db })).toEqual({
      email: "olive@example.com",
      canApply: true,
      application: null,
    })
    expect(
      (await getApplicationStatus({ session: as("ADMIN"), db })).canApply
    ).toBe(false)
  })

  it("TC-E4S1-39: a rejection or suspension carries the reason recorded with that decision, looked up by its own action", async () => {
    for (const [status, action] of [
      ["REJECTED", "vendor.rejected"],
      ["SUSPENDED", "vendor.suspended"],
    ] as const) {
      const { db, calls } = fakeDb([vendor(status)])
      const result = await getApplicationStatus({ session: as("TOURIST"), db })

      expect(result.application).toMatchObject({ status, reason: "No licence" })
      expect(calls.audit[0]).toMatchObject({
        where: { entityType: "Vendor", entityId: "v1", action },
        orderBy: { at: "desc" },
      })
    }
  })

  it("TC-E4S1-40: pending and approved vendors have no reason, and no audit query is made for them", async () => {
    for (const status of ["PENDING", "APPROVED"] as const) {
      const { db, calls } = fakeDb([vendor(status)])
      const result = await getApplicationStatus({ session: as("TOURIST"), db })

      expect(result.application?.reason).toBeNull()
      expect(calls.audit).toHaveLength(0)
    }
  })

  it("TC-E4S1-41: a decision recorded without a usable reason gives no reason, never a crash", async () => {
    for (const meta of [null, {}, { reason: 5 }, "text", []]) {
      const { db } = fakeDb([vendor("REJECTED")], meta)

      expect(
        (await getApplicationStatus({ session: as("TOURIST"), db })).application
          ?.reason,
        JSON.stringify(meta)
      ).toBeNull()
    }
  })
})
