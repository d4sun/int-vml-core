import type { PlatformRole, PrismaClient, VendorRole } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { publiclyVisibleListingWhere } from "@/lib/catalog/visibility"
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors"
import {
  createListing,
  getVendorListing,
  listVendorListings,
  submitListing,
  updateListing,
} from "@/lib/services/listing"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

let prisma: PrismaClient
let h: AuthHarness
let categoryId: string
let otherCategoryId: string

beforeAll(() => {
  prisma = createTestPrismaClient()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await truncatePublicSchema(prisma)
  h = makeHarness({ database: prismaAuthDatabase(prisma) })
  categoryId = (
    await prisma.category.create({
      data: { name: "Tours", slug: "tours", type: "TIMED_SLOT" },
    })
  ).id
  otherCategoryId = (
    await prisma.category.create({
      data: { name: "Events", slug: "events", type: "TIMED_SLOT" },
    })
  ).id
})

async function user(platformRole: PlatformRole = "VENDOR") {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole },
  })

  return { id: row.id, session: await h.sessionFor(email, password) }
}

let n = 0
async function vendorWith(
  members: { user: { id: string }; role: VendorRole }[],
  status: "APPROVED" | "PENDING" | "SUSPENDED" = "APPROVED"
) {
  n += 1

  return prisma.vendor.create({
    data: {
      name: `Vendor ${n}`,
      slug: `vendor-${n}-${Date.now()}`,
      status,
      members: {
        create: members.map((m) => ({ userId: m.user.id, role: m.role })),
      },
    },
  })
}

const deps = (u: { session: Awaited<ReturnType<typeof user>>["session"] }) => ({
  session: u.session,
  db: prisma,
})

const draft = (vendorId: string, over: Record<string, unknown> = {}) => ({
  vendorId,
  categoryId,
  title: "Thames Walking Tour",
  ...over,
})

const statusOf = async (id: string) =>
  (await prisma.listing.findUniqueOrThrow({ where: { id } })).status

describe("listings on Postgres", () => {
  it("TC-E5S1-01: a new listing is a DRAFT owned by the caller's vendor, and is not public", async () => {
    const owner = await user()
    const vendor = await vendorWith([{ user: owner, role: "OWNER" }])
    const created = await createListing(
      draft(vendor.id, {
        description: "A guided walk.",
        address: "South Bank",
        lat: 51.5,
        lng: -0.12,
      }),
      deps(owner)
    )

    expect(created).toMatchObject({
      vendorId: vendor.id,
      status: "DRAFT",
      description: "A guided walk.",
      lat: 51.5,
    })
    expect(created.slug).toMatch(/^thames-walking-tour-[a-z0-9]{6}$/)
    expect(
      await prisma.listing.count({ where: publiclyVisibleListingWhere() })
    ).toBe(0)
  })

  it("TC-E5S1-02: submitting a draft moves it to review, and it stays out of public view", async () => {
    const owner = await user()
    const vendor = await vendorWith([{ user: owner, role: "OWNER" }])
    const { id } = await createListing(draft(vendor.id), deps(owner))

    expect((await submitListing({ id }, deps(owner))).status).toBe(
      "PENDING_REVIEW"
    )
    expect(await statusOf(id)).toBe("PENDING_REVIEW")
    expect(
      await prisma.listing.count({ where: publiclyVisibleListingWhere() })
    ).toBe(0)
    await expect(submitListing({ id }, deps(owner))).rejects.toBeInstanceOf(
      ConflictError
    )
  })

  it("TC-E5S1-03: editing a published listing's core details sends it back to review and out of public view", async () => {
    const owner = await user()
    const vendor = await vendorWith([{ user: owner, role: "OWNER" }])
    const { id } = await createListing(draft(vendor.id), deps(owner))

    // An admin published it (E9-S1); simulate that decision.
    await prisma.listing.update({
      where: { id },
      data: { status: "PUBLISHED" },
    })
    expect(
      await prisma.listing.count({ where: publiclyVisibleListingWhere() })
    ).toBe(1)

    const updated = await updateListing(
      { id, title: "Thames Walking Tour (new route)" },
      deps(owner)
    )

    expect(updated.status).toBe("PENDING_REVIEW")
    expect(await statusOf(id)).toBe("PENDING_REVIEW")
    expect(
      await prisma.listing.count({ where: publiclyVisibleListingWhere() })
    ).toBe(0)
  })

  it("TC-E5S1-04: another vendor's member cannot read, edit or submit the listing, and nothing changes", async () => {
    const owner = await user()
    const rival = await user()
    const vendor = await vendorWith([{ user: owner, role: "OWNER" }])

    await vendorWith([{ user: rival, role: "OWNER" }])

    const { id } = await createListing(draft(vendor.id), deps(owner))

    await expect(
      updateListing({ id, title: "Hijacked title" }, deps(rival))
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(submitListing({ id }, deps(rival))).rejects.toBeInstanceOf(
      ForbiddenError
    )
    await expect(getVendorListing({ id }, deps(rival))).rejects.toBeInstanceOf(
      ForbiddenError
    )
    await expect(
      listVendorListings({ vendorId: vendor.id }, deps(rival))
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      createListing(draft(vendor.id), deps(rival))
    ).rejects.toBeInstanceOf(ForbiddenError)

    const row = await prisma.listing.findUniqueOrThrow({ where: { id } })

    expect(row.title).toBe("Thames Walking Tour")
    expect(row.status).toBe("DRAFT")
    expect(await prisma.listing.count()).toBe(1)
  })

  it("a missing listing looks the same as another vendor's", async () => {
    const owner = await user()

    await vendorWith([{ user: owner, role: "OWNER" }])

    await expect(
      updateListing(
        { id: "00000000-0000-0000-0000-000000000000", title: "Nothing" },
        deps(owner)
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("staff can manage listings; an admin who is not a member cannot", async () => {
    const owner = await user()
    const staff = await user()
    const admin = await user("ADMIN")
    const vendor = await vendorWith([
      { user: owner, role: "OWNER" },
      { user: staff, role: "STAFF" },
    ])
    const { id } = await createListing(draft(vendor.id), deps(staff))

    await updateListing({ id, title: "Staff edit" }, deps(staff))

    expect(
      (await listVendorListings({ vendorId: vendor.id }, deps(owner)))[0]?.title
    ).toBe("Staff edit")
    await expect(
      updateListing({ id, title: "Admin edit" }, deps(admin))
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("a vendor that is not approved cannot create, edit or submit", async () => {
    for (const status of ["PENDING", "SUSPENDED"] as const) {
      const owner = await user()
      const vendor = await vendorWith([{ user: owner, role: "OWNER" }], status)

      await expect(
        createListing(draft(vendor.id), deps(owner))
      ).rejects.toMatchObject({ details: { reason: "NOT_APPROVED" } })

      const existing = await prisma.listing.create({
        data: {
          vendorId: vendor.id,
          categoryId,
          title: "Existing",
          slug: `existing-${status}`,
        },
      })

      await expect(
        updateListing({ id: existing.id, title: "Changed" }, deps(owner))
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(
        submitListing({ id: existing.id }, deps(owner))
      ).rejects.toBeInstanceOf(ForbiddenError)
      expect(await statusOf(existing.id)).toBe("DRAFT")
    }
  })

  it("nothing a vendor sends can set the status, the slug or the owning vendor", async () => {
    const owner = await user()
    const vendor = await vendorWith([{ user: owner, role: "OWNER" }])
    const other = await vendorWith([])
    const { id } = await createListing(draft(vendor.id), deps(owner))

    for (const extra of [
      { status: "PUBLISHED" },
      { vendorId: other.id },
      { slug: "mine" },
    ]) {
      await expect(
        updateListing({ id, title: "Changed", ...extra }, deps(owner))
      ).rejects.toBeInstanceOf(ValidationError)
    }

    await expect(
      createListing({ ...draft(vendor.id), status: "PUBLISHED" }, deps(owner))
    ).rejects.toBeInstanceOf(ValidationError)

    const row = await prisma.listing.findUniqueOrThrow({ where: { id } })

    expect(row).toMatchObject({ status: "DRAFT", vendorId: vendor.id })
  })

  it("a listing under review is frozen; a rejected one can be fixed and resubmitted", async () => {
    const owner = await user()
    const vendor = await vendorWith([{ user: owner, role: "OWNER" }])
    const { id } = await createListing(draft(vendor.id), deps(owner))

    await submitListing({ id }, deps(owner))
    await expect(
      updateListing({ id, title: "Changed during review" }, deps(owner))
    ).rejects.toBeInstanceOf(ConflictError)

    // An admin rejected it (E9-S1); simulate that decision.
    await prisma.listing.update({ where: { id }, data: { status: "REJECTED" } })

    const fixed = await updateListing({ id, title: "Fixed title" }, deps(owner))

    expect(fixed.status).toBe("REJECTED")
    expect((await submitListing({ id }, deps(owner))).status).toBe(
      "PENDING_REVIEW"
    )
  })

  it("a decision made between the read and the write wins: the vendor's stale write is a Conflict", async () => {
    const owner = await user()
    const vendor = await vendorWith([{ user: owner, role: "OWNER" }])
    const { id } = await createListing(draft(vendor.id), deps(owner))
    const racing = {
      ...deps(owner),
      db: new Proxy(prisma, {
        get(target, prop, receiver) {
          if (prop !== "listing") return Reflect.get(target, prop, receiver)

          return new Proxy(target.listing, {
            get(listingTarget, method, r) {
              if (method !== "updateMany") {
                return Reflect.get(listingTarget, method, r)
              }

              return async (
                args: Parameters<typeof prisma.listing.updateMany>[0]
              ) => {
                // The admin publishes in the gap.
                await prisma.listing.update({
                  where: { id },
                  data: { status: "PUBLISHED" },
                })

                return listingTarget.updateMany(args)
              }
            },
          })
        },
      }),
    }

    await expect(
      updateListing({ id, title: "Stale edit" }, racing)
    ).rejects.toBeInstanceOf(ConflictError)

    const row = await prisma.listing.findUniqueOrThrow({ where: { id } })

    expect(row.status).toBe("PUBLISHED")
    expect(row.title).toBe("Thames Walking Tour")
  })

  it("moving a listing to another category, and a missing category", async () => {
    const owner = await user()
    const vendor = await vendorWith([{ user: owner, role: "OWNER" }])
    const { id } = await createListing(draft(vendor.id), deps(owner))

    expect(
      (await updateListing({ id, categoryId: otherCategoryId }, deps(owner)))
        .categoryId
    ).toBe(otherCategoryId)
    await expect(
      updateListing({ id, categoryId: "no-such-category" }, deps(owner))
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      createListing(
        draft(vendor.id, { categoryId: "no-such-category" }),
        deps(owner)
      )
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("two listings with the same title get different slugs", async () => {
    const owner = await user()
    const vendor = await vendorWith([{ user: owner, role: "OWNER" }])
    const a = await createListing(draft(vendor.id), deps(owner))
    const b = await createListing(draft(vendor.id), deps(owner))

    expect(a.slug).not.toBe(b.slug)
  })
})
