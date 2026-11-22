import { describe, expect, it } from "vitest"
import type { SessionSource } from "@/lib/auth/guards"
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors"
import { applyAsVendor } from "@/lib/services/vendor-application"
import {
  VENDOR_DESCRIPTION_MAX_LENGTH,
  VENDOR_NAME_MAX_LENGTH,
  vendorApplicationSchema,
} from "@/lib/validation/vendor-application"
import { describeAuditAction } from "@/lib/vendors/presentation"
import { randomSlugSuffix, slugify, vendorSlug } from "@/lib/vendors/slug"

describe("vendorApplicationSchema", () => {
  it("TC-E4S1-05: accepts a name alone, and trims and normalises everything", () => {
    expect(vendorApplicationSchema.parse({ name: "  Thames Tours  " })).toEqual(
      {
        name: "Thames Tours",
      }
    )
    expect(
      vendorApplicationSchema.parse({
        name: "Thames Tours",
        description: "  Walking tours.  ",
        contactEmail: "  Hello@Thames.Example ",
      })
    ).toEqual({
      name: "Thames Tours",
      description: "Walking tours.",
      contactEmail: "hello@thames.example",
    })
  })

  it("TC-E4S1-06: blank optional fields mean 'not given', so an empty form box is not an error", () => {
    expect(
      vendorApplicationSchema.parse({
        name: "Thames Tours",
        description: "   ",
        contactEmail: "",
      })
    ).toEqual({ name: "Thames Tours" })
  })

  it("TC-E4S1-07: rejects a missing, too short or too long name, a long description and a bad email", () => {
    const bad = [
      {},
      { name: "" },
      { name: " a " },
      { name: "x".repeat(VENDOR_NAME_MAX_LENGTH + 1) },
      {
        name: "Ok name",
        description: "d".repeat(VENDOR_DESCRIPTION_MAX_LENGTH + 1),
      },
      { name: "Ok name", contactEmail: "not-an-email" },
    ]

    for (const input of bad) {
      expect(
        vendorApplicationSchema.safeParse(input).success,
        JSON.stringify(input).slice(0, 60)
      ).toBe(false)
    }
  })

  it("TC-E4S1-08: the caller cannot name a status, an owner, an approver or an id", () => {
    for (const extra of [
      { status: "APPROVED" },
      { approvedByAdminId: "someone" },
      { ownerId: "someone" },
      { id: "v1" },
      { slug: "mine" },
    ]) {
      expect(
        vendorApplicationSchema.safeParse({ name: "Thames Tours", ...extra })
          .success,
        Object.keys(extra)[0]
      ).toBe(false)
    }
  })
})

describe("slugs", () => {
  it("TC-E4S1-09: slugify gives URL-safe, lower-case text with no stray hyphens", () => {
    expect(slugify("Thames Tours")).toBe("thames-tours")
    expect(slugify("  Café  Crème & Co.  ")).toBe("cafe-creme-co")
    expect(slugify("Tower--Bridge___Tours!!!")).toBe("tower-bridge-tours")
    expect(slugify("A/B <script>")).toBe("a-b-script")
  })

  it("TC-E4S1-10: a name with no usable characters, or a very long one, still gives a valid slug", () => {
    expect(slugify("🚀🎉")).toBe("vendor")
    expect(slugify("---")).toBe("vendor")
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(40)
    expect(slugify(`${"a".repeat(39)} b`)).not.toMatch(/-$/)
  })

  it("TC-E4S1-11: the suffix separates names that slugify alike, and random suffixes are six safe characters", () => {
    expect(vendorSlug("Thames Tours", "k3x9ab")).toBe("thames-tours-k3x9ab")
    expect(vendorSlug("Thames Tours!", "q1w2e3")).not.toBe(
      vendorSlug("Thames Tours", "k3x9ab")
    )

    const seen = new Set<string>()
    for (let i = 0; i < 50; i += 1) {
      const suffix = randomSlugSuffix()

      expect(suffix).toMatch(/^[a-z0-9]{6}$/)
      seen.add(suffix)
    }
    expect(seen.size).toBeGreaterThan(40)
  })
})

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

const untouched = new Proxy(
  {},
  {
    get() {
      throw new Error("the database must not be reached")
    },
  }
) as never

describe("applyAsVendor guards", () => {
  it("TC-E4S1-12: signed out is a 401, before anything else", async () => {
    await expect(
      applyAsVendor(
        { name: "Thames Tours" },
        { session: as(null), db: untouched }
      )
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" })
  })

  it("TC-E4S1-13: administrators cannot apply, and the database is not reached", async () => {
    await expect(
      applyAsVendor(
        { name: "Thames Tours" },
        { session: as("ADMIN"), db: untouched }
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("TC-E4S1-14: invalid input is a ValidationError with field errors, before any write", async () => {
    for (const role of ["TOURIST", "VENDOR"]) {
      const error = await applyAsVendor(
        { name: "" },
        { session: as(role), db: untouched }
      ).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ValidationError)
      expect(
        (error as ValidationError).fieldErrors?.name?.length
      ).toBeGreaterThan(0)
    }

    for (const input of [
      null,
      undefined,
      "x",
      5,
      { status: "APPROVED", name: "X Y" },
    ]) {
      await expect(
        applyAsVendor(input, { session: as("TOURIST"), db: untouched })
      ).rejects.toBeInstanceOf(ValidationError)
    }
  })
})

describe("applyAsVendor serialisation", () => {
  it("TC-E4S1-31: the applicant's user row is locked FOR UPDATE, before the open-application check", async () => {
    const calls: string[] = []
    const tx = {
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        calls.push(
          `lock:${strings.join("?").replace(/\s+/g, " ").trim()}:${values.join(",")}`
        )

        return [{ id: "u1" }]
      },
      vendor: {
        findFirst: async () => {
          calls.push("check-open")

          return { id: "existing" }
        },
      },
    }
    const db = {
      $transaction: async (fn: (t: never) => unknown) => fn(tx as never),
    } as never

    await expect(
      applyAsVendor({ name: "Thames Tours" }, { session: as("TOURIST"), db })
    ).rejects.toBeInstanceOf(ConflictError)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain("FOR UPDATE")
    expect(calls[0]).toContain('"User"')
    expect(calls[0]?.endsWith(":u1")).toBe(true)
    expect(calls[1]).toBe("check-open")
  })

  it("TC-E4S1-32: an account that no longer exists is a not-found, not an application", async () => {
    const tx = { $queryRaw: async () => [] }
    const db = {
      $transaction: async (fn: (t: never) => unknown) => fn(tx as never),
    } as never

    await expect(
      applyAsVendor({ name: "Thames Tours" }, { session: as("TOURIST"), db })
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe("audit label", () => {
  it("TC-E4S1-15: the application is shown as 'Applied' in a vendor's history", () => {
    expect(describeAuditAction("vendor.applied")).toBe("Applied")
  })
})
