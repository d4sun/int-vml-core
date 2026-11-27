import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { NotFoundError } from "@/lib/errors"
import {
  addTripItem,
  createTrip,
  deleteTrip,
  getTrip,
  listTrips,
  removeTripItem,
  renameTrip,
  reorderTripItems,
} from "@/lib/services/trip"
import { ConflictError } from "@/lib/errors"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

let prisma: PrismaClient
let categoryId: string

beforeAll(() => {
  prisma = createTestPrismaClient()
})
afterAll(async () => {
  await prisma.$disconnect()
})
beforeEach(async () => {
  await truncatePublicSchema(prisma)
  categoryId = (
    await prisma.category.create({
      data: { name: "Tours", slug: "tours", type: "TIMED_SLOT" },
    })
  ).id
})

async function tourist(email: string) {
  const u = await prisma.user.create({
    data: { email, name: email, emailVerified: true, platformRole: "TOURIST" },
  })
  return {
    id: u.id,
    session: async () => ({
      user: {
        id: u.id,
        email,
        name: email,
        emailVerified: true,
        platformRole: "TOURIST",
      },
    }),
  }
}

let n = 0
async function listing(
  status: "PUBLISHED" | "DRAFT" = "PUBLISHED",
  vendorStatus: "APPROVED" | "SUSPENDED" = "APPROVED"
) {
  n += 1
  const vendor = await prisma.vendor.create({
    data: {
      name: `V${n}`,
      slug: `v-${n}`,
      status: vendorStatus,
      stripeOnboardingComplete: true,
    },
  })
  return prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId,
      title: `Walk ${n}`,
      slug: `walk-${n}`,
      status,
    },
  })
}

const deps = (u: { session: () => Promise<unknown> }) => ({
  session: u.session as never,
  db: prisma,
})

describe("trips (Postgres)", () => {
  it("TC-E1S2-01: adding a listing puts it at the next position, after the last one", async () => {
    const u = await tourist("olive@example.com")
    const trip = await createTrip({ name: "Summer" }, deps(u))
    const a = await listing()
    const b = await listing()

    await addTripItem({ tripId: trip.id, listingId: a.id }, deps(u))
    const after = await addTripItem(
      { tripId: trip.id, listingId: b.id, plannedDate: "2030-06-01" },
      deps(u)
    )

    expect(after.items.map((i) => i.listingId)).toEqual([a.id, b.id])
    expect(after.items.map((i) => i.position)).toEqual([0, 1])
    expect(after.items[1]!.plannedDate).toBe("2030-06-01")
  })

  it("a draft or a suspended vendor's listing cannot be added to a trip", async () => {
    const u = await tourist("olive@example.com")
    const trip = await createTrip({ name: "Summer" }, deps(u))
    const draft = await listing("DRAFT")
    const suspended = await listing("PUBLISHED", "SUSPENDED")

    await expect(
      addTripItem({ tripId: trip.id, listingId: draft.id }, deps(u))
    ).rejects.toThrow(NotFoundError)
    await expect(
      addTripItem({ tripId: trip.id, listingId: suspended.id }, deps(u))
    ).rejects.toThrow(NotFoundError)
  })

  it("TC-E1S2-03: another visitor cannot see, rename, add to, or delete a trip, and gets the same not-found", async () => {
    const owner = await tourist("owner@example.com")
    const other = await tourist("other@example.com")
    const trip = await createTrip({ name: "Mine" }, deps(owner))
    const a = await listing()

    await expect(getTrip(trip.id, deps(other))).rejects.toThrow(NotFoundError)
    await expect(
      renameTrip({ tripId: trip.id, name: "Stolen" }, deps(other))
    ).rejects.toThrow(NotFoundError)
    await expect(
      addTripItem({ tripId: trip.id, listingId: a.id }, deps(other))
    ).rejects.toThrow(NotFoundError)
    await expect(deleteTrip({ tripId: trip.id }, deps(other))).rejects.toThrow(
      NotFoundError
    )

    expect((await getTrip(trip.id, deps(owner))).name).toBe("Mine")
    expect(await listTrips(deps(other))).toEqual([])
  })

  it("removing an item keeps the order of the rest; the listing itself is untouched", async () => {
    const u = await tourist("olive@example.com")
    const trip = await createTrip({ name: "Summer" }, deps(u))
    const a = await listing()
    const b = await listing()
    const c = await listing()
    await addTripItem({ tripId: trip.id, listingId: a.id }, deps(u))
    const withB = await addTripItem(
      { tripId: trip.id, listingId: b.id },
      deps(u)
    )
    await addTripItem({ tripId: trip.id, listingId: c.id }, deps(u))

    const after = await removeTripItem({ itemId: withB.items[1]!.id }, deps(u))

    expect(after.items.map((i) => i.listingId)).toEqual([a.id, c.id])
    expect(await prisma.listing.count({ where: { id: b.id } })).toBe(1)
  })

  it("deleting a trip removes its items with it", async () => {
    const u = await tourist("olive@example.com")
    const trip = await createTrip({ name: "Summer" }, deps(u))
    const a = await listing()
    await addTripItem({ tripId: trip.id, listingId: a.id }, deps(u))

    await deleteTrip({ tripId: trip.id }, deps(u))

    expect(await prisma.tripItem.count()).toBe(0)
    expect(await prisma.listing.count({ where: { id: a.id } })).toBe(1)
  })

  it("TC-E1S2-02: a reorder puts the items in the new order, positions 0..n-1 with no gaps or repeats", async () => {
    const u = await tourist("olive@example.com")
    const trip = await createTrip({ name: "Summer" }, deps(u))
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const l = await listing()
      ids.push(
        (
          await addTripItem({ tripId: trip.id, listingId: l.id }, deps(u))
        ).items.at(-1)!.id
      )
    }

    const reordered = await reorderTripItems(
      { tripId: trip.id, itemIds: [ids[2]!, ids[0]!, ids[1]!] },
      deps(u)
    )

    expect(reordered.items.map((i) => i.id)).toEqual([ids[2], ids[0], ids[1]])
    expect(reordered.items.map((i) => i.position)).toEqual([0, 1, 2])
  })

  it("a reorder that leaves an item out, or adds one that is not there, is refused and nothing moves", async () => {
    const u = await tourist("olive@example.com")
    const trip = await createTrip({ name: "Summer" }, deps(u))
    const a = await addTripItem(
      { tripId: trip.id, listingId: (await listing()).id },
      deps(u)
    )
    const withTwo = await addTripItem(
      { tripId: trip.id, listingId: (await listing()).id },
      deps(u)
    )
    const [first, second] = withTwo.items.map((i) => i.id) as [string, string]
    void a

    await expect(
      reorderTripItems({ tripId: trip.id, itemIds: [second] }, deps(u))
    ).rejects.toThrow(ConflictError)
    await expect(
      reorderTripItems(
        { tripId: trip.id, itemIds: [second, first, "ghost"] },
        deps(u)
      )
    ).rejects.toThrow(ConflictError)

    const after = await getTrip(trip.id, deps(u))
    expect(after.items.map((i) => i.id)).toEqual([first, second])
  })

  it("another visitor cannot reorder a trip", async () => {
    const owner = await tourist("owner@example.com")
    const other = await tourist("other@example.com")
    const trip = await createTrip({ name: "Mine" }, deps(owner))
    const withOne = await addTripItem(
      { tripId: trip.id, listingId: (await listing()).id },
      deps(owner)
    )
    const id = withOne.items[0]!.id

    await expect(
      reorderTripItems({ tripId: trip.id, itemIds: [id] }, deps(other))
    ).rejects.toThrow(NotFoundError)
  })
})
