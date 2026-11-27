import { describe, expect, it } from "vitest"
import type { SessionSource } from "@/lib/auth/guards"
import {
  effectiveCommissionBps,
  PLATFORM_DEFAULT_COMMISSION_BPS,
} from "@/lib/commission/rate"
import { ForbiddenError, ValidationError } from "@/lib/errors"
import { setVendorCommission } from "@/lib/services/vendor-commission"
import { setVendorCommissionSchema } from "@/lib/validation/vendor-commission"

const as =
  (platformRole: string | null): SessionSource =>
  async () =>
    platformRole
      ? {
          user: {
            id: "u1",
            email: "a@example.com",
            name: "A",
            emailVerified: true,
            platformRole,
          },
        }
      : null

const untouchedDb = {
  $transaction: async () => {
    throw new Error("the database must not be reached")
  },
} as never

describe("setVendorCommissionSchema", () => {
  it("accepts a whole basis-point value, and null to clear it", () => {
    expect(
      setVendorCommissionSchema.safeParse({
        vendorId: "v",
        commissionBps: 1250,
      }).success
    ).toBe(true)
    expect(
      setVendorCommissionSchema.safeParse({
        vendorId: "v",
        commissionBps: null,
      }).success
    ).toBe(true)
  })

  it("refuses fractions, negatives, more than 100%, NaN and a missing vendor", () => {
    expect(
      setVendorCommissionSchema.safeParse({
        vendorId: "v",
        commissionBps: 12.5,
      }).success
    ).toBe(false)
    expect(
      setVendorCommissionSchema.safeParse({ vendorId: "v", commissionBps: -1 })
        .success
    ).toBe(false)
    expect(
      setVendorCommissionSchema.safeParse({
        vendorId: "v",
        commissionBps: 10001,
      }).success
    ).toBe(false)
    expect(
      setVendorCommissionSchema.safeParse({
        vendorId: "v",
        commissionBps: Number.NaN,
      }).success
    ).toBe(false)
    expect(
      setVendorCommissionSchema.safeParse({ vendorId: "", commissionBps: 1000 })
        .success
    ).toBe(false)
  })

  it("refuses any other field, such as a rate for a category", () => {
    expect(
      setVendorCommissionSchema.safeParse({
        vendorId: "v",
        commissionBps: 1000,
        categoryId: "c",
      }).success
    ).toBe(false)
  })
})

describe("which commission applies", () => {
  it("the vendor's own override wins over the category default", () => {
    expect(
      effectiveCommissionBps({
        vendorOverrideBps: 1500,
        categoryDefaultBps: 2000,
      })
    ).toEqual({
      bps: 1500,
      source: "VENDOR",
    })
  })

  it("without an override, the category default applies", () => {
    expect(
      effectiveCommissionBps({
        vendorOverrideBps: null,
        categoryDefaultBps: 2000,
      })
    ).toEqual({
      bps: 2000,
      source: "CATEGORY",
    })
  })

  it("with neither, the platform default applies", () => {
    expect(
      effectiveCommissionBps({
        vendorOverrideBps: null,
        categoryDefaultBps: null,
      })
    ).toEqual({
      bps: PLATFORM_DEFAULT_COMMISSION_BPS,
      source: "PLATFORM",
    })
  })

  it("a vendor override of zero is still an override", () => {
    expect(
      effectiveCommissionBps({ vendorOverrideBps: 0, categoryDefaultBps: 2000 })
        .source
    ).toBe("VENDOR")
  })
})

describe("setting a vendor's commission (admin only)", () => {
  const input = { vendorId: "v1", commissionBps: 1250 }

  it("refuses a vendor, a tourist and a signed-out caller before reading anything", async () => {
    await expect(
      setVendorCommission(input, { session: as("VENDOR"), db: untouchedDb })
    ).rejects.toThrow(ForbiddenError)
    await expect(
      setVendorCommission(input, { session: as("TOURIST"), db: untouchedDb })
    ).rejects.toThrow(ForbiddenError)
    await expect(
      setVendorCommission(input, { session: as(null), db: untouchedDb })
    ).rejects.toThrow()
  })

  it("rejects invalid input before the database is reached", async () => {
    await expect(
      setVendorCommission(
        { vendorId: "v1", commissionBps: 1.5 },
        { session: as("ADMIN"), db: untouchedDb }
      )
    ).rejects.toThrow(ValidationError)
  })
})
