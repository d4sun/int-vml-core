import { describe, expect, it } from "vitest"
import type { MembershipStore, SessionSource } from "@/lib/auth/guards"
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors"
import {
  createListing,
  getVendorListing,
  listVendorListings,
  submitListing,
  updateListing,
} from "@/lib/services/listing"

type L = {
  id: string
  vendorId: string
  categoryId: string
  title: string
  slug: string
  description: string | null
  address: string | null
  lat: number | null
  lng: number | null
  status: string
}

const listing = (over: Partial<L> = {}): L => ({
  id: "l1",
  vendorId: "v1",
  categoryId: "c1",
  title: "Thames Walk",
  slug: "thames-walk-abc123",
  description: null,
  address: null,
  lat: null,
  lng: null,
  status: "DRAFT",
  ...over,
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

function setup(
  options: {
    listings?: L[]
    vendorStatus?: string | null
    role?: "OWNER" | "STAFF" | null
    categories?: string[]
    raceOnUpdate?: boolean
  } = {}
) {
  const rows = options.listings ?? [listing()]
  const log: string[] = []
  const creates: unknown[] = []
  const updates: { where: unknown; data: Record<string, unknown> }[] = []
  const vendorStatus =
    options.vendorStatus === undefined ? "APPROVED" : options.vendorStatus

  const db = {
    listing: {
      findUnique: async (a: { where: { id: string } }) => {
        log.push("find")
        return rows.find((r) => r.id === a.where.id) ?? null
      },
      findMany: async (a: unknown) => {
        log.push("findMany")
        creates.push(a)
        return rows
      },
      create: async (a: { data: Record<string, unknown> }) => {
        log.push("create")
        creates.push(a.data)
        return { ...listing(), ...a.data, id: "new" }
      },
      updateMany: async (a: {
        where: unknown
        data: Record<string, unknown>
      }) => {
        log.push("update")
        updates.push(a)
        return { count: options.raceOnUpdate ? 0 : 1 }
      },
    },
    vendor: {
      findUnique: async () => (vendorStatus ? { status: vendorStatus } : null),
    },
    category: {
      findUnique: async (a: { where: { id: string } }) =>
        (options.categories ?? ["c1", "c2"]).includes(a.where.id)
          ? { id: a.where.id }
          : null,
    },
  } as never

  const memberships: MembershipStore = {
    findMembership: async (_u, vendorId) => {
      log.push(`member:${vendorId}`)
      const role = options.role === undefined ? "OWNER" : options.role

      return role && vendorId === "v1" ? { role } : null
    },
  }

  return {
    log,
    creates,
    updates,
    deps: {
      session: as("u1"),
      db,
      memberships,
      suffix: () => "abc123",
    },
  }
}

const valid = { vendorId: "v1", categoryId: "c1", title: "Thames Walk" }

describe("createListing", () => {
  it("TC-E5S1-01: creates a DRAFT in the caller's vendor with a generated slug", async () => {
    const t = setup()
    const created = await createListing(valid, t.deps)

    expect(created).toMatchObject({
      vendorId: "v1",
      status: "DRAFT",
      slug: "thames-walk-abc123",
    })
    expect(t.creates[0]).toMatchObject({
      status: "DRAFT",
      vendorId: "v1",
      description: null,
      lat: null,
    })
  })

  it("signed out is a 401 before anything else", async () => {
    const t = setup()

    await expect(
      createListing(valid, { ...t.deps, session: as(null) })
    ).rejects.toMatchObject({ status: 401 })
    expect(t.log).toEqual([])
  })

  it("invalid input is a ValidationError before the membership check", async () => {
    const t = setup({ role: null })

    await expect(
      createListing({ ...valid, title: "x" }, t.deps)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(t.log).toEqual([])
  })

  it("TC-E5S1-04: someone who does not belong to the vendor cannot create", async () => {
    const t = setup({ role: null })

    await expect(createListing(valid, t.deps)).rejects.toBeInstanceOf(
      ForbiddenError
    )
    await expect(
      createListing({ ...valid, vendorId: "v2" }, setup().deps)
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(t.log).not.toContain("create")
  })

  it("staff may create", async () => {
    await expect(
      createListing(valid, setup({ role: "STAFF" }).deps)
    ).resolves.toMatchObject({ status: "DRAFT" })
  })

  it.each(["PENDING", "SUSPENDED", "REJECTED", null])(
    "a %s vendor cannot create listings",
    async (vendorStatus) => {
      const t = setup({ vendorStatus })
      const error = await createListing(valid, t.deps).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ForbiddenError)
      expect((error as ForbiddenError).details).toEqual({
        reason: "NOT_APPROVED",
      })
      expect(t.log).not.toContain("create")
    }
  )

  it("an unknown category is a ValidationError on categoryId", async () => {
    const t = setup()
    const error = await createListing(
      { ...valid, categoryId: "nope" },
      t.deps
    ).catch((e: unknown) => e)

    expect((error as ValidationError).fieldErrors).toHaveProperty("categoryId")
    expect(t.log).not.toContain("create")
  })
})

describe("updateListing", () => {
  it("edits a draft and leaves it a draft", async () => {
    const t = setup()
    const updated = await updateListing(
      { id: "l1", title: "New title" },
      t.deps
    )

    expect(updated).toMatchObject({ title: "New title", status: "DRAFT" })
    expect(t.updates[0]?.where).toEqual({ id: "l1", status: "DRAFT" })
  })

  it("TC-E5S1-03: editing a published listing's core details sends it to review", async () => {
    const t = setup({ listings: [listing({ status: "PUBLISHED" })] })
    const updated = await updateListing(
      { id: "l1", title: "New title" },
      t.deps
    )

    expect(updated.status).toBe("PENDING_REVIEW")
    expect(t.updates[0]?.data).toMatchObject({ status: "PENDING_REVIEW" })
    expect(t.updates[0]?.where).toEqual({ id: "l1", status: "PUBLISHED" })
  })

  it("the status is not accepted from the caller", async () => {
    const t = setup()

    await expect(
      updateListing({ id: "l1", status: "PUBLISHED" }, t.deps)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(t.log).not.toContain("update")
  })

  it("a listing under review is frozen", async () => {
    const t = setup({ listings: [listing({ status: "PENDING_REVIEW" })] })
    const error = await updateListing({ id: "l1", title: "New" }, t.deps).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect(t.log).not.toContain("update")
  })

  it("an archived listing cannot be edited", async () => {
    await expect(
      updateListing(
        { id: "l1", title: "New" },
        setup({ listings: [listing({ status: "ARCHIVED" })] }).deps
      )
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it("a rejected listing can be fixed and stays rejected until resubmitted", async () => {
    const t = setup({ listings: [listing({ status: "REJECTED" })] })

    expect(
      (await updateListing({ id: "l1", title: "Better" }, t.deps)).status
    ).toBe("REJECTED")
  })

  it("TC-E5S1-04: another vendor's listing, and a missing one, are the same refusal", async () => {
    const other = setup({ listings: [listing({ vendorId: "v2" })] })
    const missing = setup({ listings: [] })

    for (const t of [other, missing]) {
      await expect(
        updateListing({ id: "l1", title: "Hijack" }, t.deps)
      ).rejects.toBeInstanceOf(ForbiddenError)
      expect(t.log).not.toContain("update")
    }
  })

  it("a suspended vendor cannot edit", async () => {
    await expect(
      updateListing(
        { id: "l1", title: "New" },
        setup({ vendorStatus: "SUSPENDED" }).deps
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("a no-op edit writes nothing and keeps a published listing published", async () => {
    const t = setup({ listings: [listing({ status: "PUBLISHED" })] })
    const same = await updateListing({ id: "l1", title: "Thames Walk" }, t.deps)

    expect(same.status).toBe("PUBLISHED")
    expect(t.log).not.toContain("update")
  })

  it("can clear the description and the location", async () => {
    const t = setup({
      listings: [listing({ description: "Old", lat: 51.5, lng: -0.1 })],
    })
    const updated = await updateListing(
      { id: "l1", description: "", lat: null, lng: null },
      t.deps
    )

    expect(updated).toMatchObject({ description: null, lat: null, lng: null })
  })

  it("a concurrent change makes the write a Conflict, not an overwrite", async () => {
    await expect(
      updateListing(
        { id: "l1", title: "New" },
        setup({ raceOnUpdate: true }).deps
      )
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it("moving to an unknown category is refused", async () => {
    await expect(
      updateListing({ id: "l1", categoryId: "nope" }, setup().deps)
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("submitListing", () => {
  it("TC-E5S1-02: a draft goes to review", async () => {
    const t = setup()

    expect((await submitListing({ id: "l1" }, t.deps)).status).toBe(
      "PENDING_REVIEW"
    )
    expect(t.updates[0]).toMatchObject({
      where: { id: "l1", status: "DRAFT" },
      data: { status: "PENDING_REVIEW" },
    })
  })

  it("a rejected listing can be resubmitted", async () => {
    const t = setup({ listings: [listing({ status: "REJECTED" })] })

    expect((await submitListing({ id: "l1" }, t.deps)).status).toBe(
      "PENDING_REVIEW"
    )
  })

  it.each(["PENDING_REVIEW", "PUBLISHED", "ARCHIVED"])(
    "a %s listing cannot be submitted",
    async (status) => {
      const t = setup({ listings: [listing({ status })] })

      await expect(submitListing({ id: "l1" }, t.deps)).rejects.toBeInstanceOf(
        ConflictError
      )
      expect(t.log).not.toContain("update")
    }
  )

  it("only a member of the listing's vendor can submit it", async () => {
    await expect(
      submitListing({ id: "l1" }, setup({ role: null }).deps)
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("a vendor that is not approved cannot submit", async () => {
    await expect(
      submitListing({ id: "l1" }, setup({ vendorStatus: "PENDING" }).deps)
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("loses a race gracefully", async () => {
    await expect(
      submitListing({ id: "l1" }, setup({ raceOnUpdate: true }).deps)
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe("reading", () => {
  it("lists only after proving membership of that vendor", async () => {
    const denied = setup({ role: null })

    await expect(
      listVendorListings({ vendorId: "v1" }, denied.deps)
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(denied.log).not.toContain("findMany")

    const ok = setup()

    expect(await listVendorListings({ vendorId: "v1" }, ok.deps)).toHaveLength(
      1
    )
    expect(ok.creates[0]).toMatchObject({ where: { vendorId: "v1" } })
  })

  it("one listing is readable only by its vendor's members", async () => {
    expect((await getVendorListing({ id: "l1" }, setup().deps)).id).toBe("l1")
    await expect(
      getVendorListing({ id: "l1" }, setup({ role: null }).deps)
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
