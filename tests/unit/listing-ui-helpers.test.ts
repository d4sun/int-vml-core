import { describe, expect, it } from "vitest"
import type { SessionSource } from "@/lib/auth/guards"
import {
  LISTING_STATUS_HELP,
  LISTING_STATUS_LABEL,
} from "@/lib/listings/presentation"
import { getVendorContext, listCategoryOptions } from "@/lib/services/listing"

const STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "PUBLISHED",
  "REJECTED",
  "ARCHIVED",
] as const

describe("listing status wording", () => {
  it("every status has a label and a help text, and the labels differ", () => {
    for (const status of STATUSES) {
      expect(LISTING_STATUS_LABEL[status].length).toBeGreaterThan(2)
      expect(LISTING_STATUS_HELP[status].length).toBeGreaterThan(10)
    }

    expect(new Set(STATUSES.map((s) => LISTING_STATUS_LABEL[s])).size).toBe(5)
  })

  it("tells a vendor that editing a live listing needs review, and that review freezes it", () => {
    expect(LISTING_STATUS_HELP.PUBLISHED).toMatch(/review/)
    expect(LISTING_STATUS_HELP.PENDING_REVIEW).toMatch(/can't be edited/)
  })
})

const as =
  (id: string | null): SessionSource =>
  async () =>
    id
      ? {
          user: {
            id,
            email: "o@example.com",
            name: "O",
            emailVerified: true,
            platformRole: "VENDOR",
          },
        }
      : null

const member = (id: string, role: "OWNER" | "STAFF" = "OWNER") => ({
  role,
  vendor: { id, name: `Vendor ${id}`, status: "APPROVED" },
})

function setup(
  rows: ReturnType<typeof member>[],
  userId: string | null = "u1"
) {
  const queries: unknown[] = []
  const db = {
    vendorMember: {
      findMany: async (args: unknown) => {
        queries.push(args)
        return rows
      },
    },
    category: {
      findMany: async () => [{ id: "c1", name: "Tours" }],
    },
  } as never

  return { queries, deps: { session: as(userId), db } }
}

describe("getVendorContext", () => {
  it("signed out is a 401 and nothing is read", async () => {
    const t = setup([member("v1")], null)

    await expect(getVendorContext({}, t.deps)).rejects.toMatchObject({
      status: 401,
    })
    expect(t.queries).toEqual([])
  })

  it("reads only the caller's memberships, oldest first, and is null with none", async () => {
    const t = setup([])

    expect(await getVendorContext({}, t.deps)).toBeNull()
    expect(t.queries[0]).toMatchObject({
      where: { userId: "u1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
  })

  it("CR-2: a vendor id that is not the caller's is ignored", async () => {
    const t = setup([member("v1"), member("v2", "STAFF")])

    expect((await getVendorContext({}, t.deps))?.vendor.id).toBe("v1")

    const chosen = await getVendorContext({ vendorId: "v2" }, t.deps)

    expect(chosen).toMatchObject({ role: "STAFF", vendor: { id: "v2" } })
    expect(chosen?.otherVendors).toEqual([
      { id: "v1", name: "Vendor v1", status: "APPROVED" },
    ])
    expect(
      (await getVendorContext({ vendorId: "someone-elses" }, t.deps))?.vendor.id
    ).toBe("v1")
  })
})

describe("listCategoryOptions", () => {
  it("needs a signed-in user", async () => {
    await expect(
      listCategoryOptions(setup([], null).deps)
    ).rejects.toMatchObject({ status: 401 })
    expect(await listCategoryOptions(setup([]).deps)).toEqual([
      { id: "c1", name: "Tours" },
    ])
  })
})
