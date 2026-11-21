import type { VendorStatus } from "@prisma/client"
import { describe, expect, it } from "vitest"
import { ForbiddenError, NotFoundError } from "@/lib/errors"
import {
  assertVendorCanSell,
  publiclyVisibleListingWhere,
  sellBlockReason,
  vendorCanSell,
} from "@/lib/catalog/visibility"

describe("publiclyVisibleListingWhere", () => {
  it("TC-E8S1-23: is exactly PUBLISHED listings of APPROVED vendors", () => {
    expect(publiclyVisibleListingWhere()).toEqual({
      status: "PUBLISHED",
      vendor: { status: "APPROVED" },
    })
  })

  it("TC-E8S1-24: extra filters are ANDed in, so the visibility rule always stays", () => {
    const where = publiclyVisibleListingWhere({
      categoryId: "c1",
      title: { contains: "tour" },
    })

    expect(where).toEqual({
      AND: [
        { categoryId: "c1", title: { contains: "tour" } },
        { status: "PUBLISHED", vendor: { status: "APPROVED" } },
      ],
    })
  })

  it("TC-E8S1-25: a caller's filter cannot override status or vendor, even when it tries to", () => {
    const where = publiclyVisibleListingWhere({
      status: "DRAFT",
      vendor: { status: "SUSPENDED" },
    })

    // The caller's values sit beside the rule, they do not replace it.
    expect(where.AND).toContainEqual({
      status: "PUBLISHED",
      vendor: { status: "APPROVED" },
    })
    expect(where).not.toHaveProperty("status")
    expect(where).not.toHaveProperty("vendor")
  })

  it("TC-E8S1-26: every call returns a fresh object, so one caller cannot change it for the next", () => {
    const first = publiclyVisibleListingWhere()
    ;(first as { status?: string }).status = "DRAFT"
    delete (first as { vendor?: unknown }).vendor

    expect(publiclyVisibleListingWhere()).toEqual({
      status: "PUBLISHED",
      vendor: { status: "APPROVED" },
    })
  })
})

// Written out by hand: a vendor sells only when APPROVED and onboarded.
const CASES: Array<[VendorStatus, boolean, string | null]> = [
  ["APPROVED", true, null],
  ["APPROVED", false, "NOT_ONBOARDED"],
  ["PENDING", true, "NOT_APPROVED"],
  ["PENDING", false, "NOT_APPROVED"],
  ["SUSPENDED", true, "NOT_APPROVED"],
  ["SUSPENDED", false, "NOT_APPROVED"],
  ["REJECTED", true, "NOT_APPROVED"],
  ["REJECTED", false, "NOT_APPROVED"],
]

describe("sell rule", () => {
  it("TC-E8S1-27: only an approved, onboarded vendor can sell (all 8 combinations)", () => {
    for (const [status, onboarded, reason] of CASES) {
      const vendor = { status, stripeOnboardingComplete: onboarded }

      expect(sellBlockReason(vendor), `${status} ${onboarded}`).toBe(reason)
      expect(vendorCanSell(vendor), `${status} ${onboarded}`).toBe(
        reason === null
      )
    }
  })

  it("TC-E8S1-28: approval is reported before onboarding when both are missing", () => {
    expect(
      sellBlockReason({ status: "PENDING", stripeOnboardingComplete: false })
    ).toBe("NOT_APPROVED")
  })
})

function fakeDb(
  row: { status: VendorStatus; stripeOnboardingComplete: boolean } | null
) {
  const calls: unknown[] = []

  return {
    calls,
    db: {
      vendor: {
        findUnique: async (args: unknown) => {
          calls.push(args)
          return row
        },
      },
    } as never,
  }
}

describe("assertVendorCanSell", () => {
  it("TC-E8S1-29: passes for an approved, onboarded vendor, looking up only that vendor", async () => {
    const { db, calls } = fakeDb({
      status: "APPROVED",
      stripeOnboardingComplete: true,
    })

    await expect(assertVendorCanSell("v1", db)).resolves.toBeUndefined()
    expect(calls).toEqual([
      {
        where: { id: "v1" },
        select: { status: true, stripeOnboardingComplete: true },
      },
    ])
  })

  it("TC-E8S1-30: refuses with a ForbiddenError that says why", async () => {
    for (const [status, onboarded, reason] of CASES) {
      if (reason === null) continue

      const { db } = fakeDb({ status, stripeOnboardingComplete: onboarded })
      const error = await assertVendorCanSell("v1", db).catch((e: unknown) => e)

      expect(error, `${status} ${onboarded}`).toBeInstanceOf(ForbiddenError)
      expect((error as ForbiddenError).status).toBe(403)
      expect((error as ForbiddenError).details).toEqual({ reason })
    }
  })

  it("TC-E8S1-31: an unknown vendor is a NotFoundError, not a pass", async () => {
    const { db } = fakeDb(null)

    await expect(assertVendorCanSell("nope", db)).rejects.toBeInstanceOf(
      NotFoundError
    )
  })
})
