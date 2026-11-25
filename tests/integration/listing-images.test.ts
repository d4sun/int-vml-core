import { randomUUID } from "node:crypto"
import type { PlatformRole, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { publiclyVisibleListingWhere } from "@/lib/catalog/visibility"
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors"
import {
  confirmImageUpload,
  listListingImages,
  removeImage,
  reorderImages,
  requestImageUpload,
} from "@/lib/services/listing-images"
import { FakeStorage } from "@/lib/storage/fake"
import { MAX_IMAGES_PER_LISTING, MAX_IMAGE_BYTES } from "@/lib/storage/limits"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

let prisma: PrismaClient
let h: AuthHarness
let storage: FakeStorage

beforeAll(() => {
  prisma = createTestPrismaClient()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await truncatePublicSchema(prisma)
  h = makeHarness({ database: prismaAuthDatabase(prisma) })
  storage = new FakeStorage({ origin: "http://localhost:3000" })
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
async function setup(
  options: {
    status?: "DRAFT" | "PUBLISHED" | "PENDING_REVIEW"
    vendorStatus?: "APPROVED" | "SUSPENDED"
  } = {}
) {
  n += 1

  const owner = await user()
  const category = await prisma.category.create({
    data: {
      name: `Cat ${n}`,
      slug: `cat-${n}-${Date.now()}`,
      type: "TIMED_SLOT",
    },
  })
  const vendor = await prisma.vendor.create({
    data: {
      name: `V${n}`,
      slug: `v-${n}-${Date.now()}`,
      status: options.vendorStatus ?? "APPROVED",
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  })
  const listing = await prisma.listing.create({
    data: {
      vendorId: vendor.id,
      categoryId: category.id,
      title: "Walk",
      slug: `walk-${n}-${Date.now()}`,
      status: options.status ?? "DRAFT",
    },
  })

  return {
    owner,
    vendor,
    listing,
    deps: { session: owner.session, db: prisma, storage },
  }
}

type S = Awaited<ReturnType<typeof setup>>

/** Request, "upload" what the browser would PUT, and confirm. */
async function addImage(
  s: S,
  bytes = 100,
  type: "image/png" | "image/jpeg" | "image/webp" = "image/png"
) {
  const { key } = await requestImageUpload(
    { listingId: s.listing.id, contentType: type, size: bytes },
    s.deps
  )

  storage.put(key, new Uint8Array(bytes), type)

  return confirmImageUpload({ listingId: s.listing.id, key }, s.deps)
}

const positions = async (listingId: string) =>
  (
    await prisma.listingImage.findMany({
      where: { listingId },
      orderBy: { position: "asc" },
    })
  ).map((i) => [i.id, i.position] as const)

describe("listing pictures on Postgres", () => {
  it("uploads and confirms pictures, which are recorded in order from 0", async () => {
    const s = await setup()
    const a = await addImage(s)
    const b = await addImage(s, 200, "image/jpeg")
    const c = await addImage(s, 300, "image/webp")

    expect([a.position, b.position, c.position]).toEqual([0, 1, 2])
    expect(b).toMatchObject({ contentType: "image/jpeg", sizeBytes: 200 })
    expect(a.key).toMatch(
      new RegExp(`^listings/${s.listing.id}/[0-9a-f-]{36}\\.png$`)
    )

    const listed = await listListingImages({ listingId: s.listing.id }, s.deps)

    expect(listed.map((i) => i.id)).toEqual([a.id, b.id, c.id])
    expect(listed[0]?.url).toBe(
      `http://localhost:3000/api/dev/storage/${a.key}`
    )
  })

  it("the upload target is for a key the server chose, never the client's", async () => {
    const s = await setup()
    const { key, upload } = await requestImageUpload(
      { listingId: s.listing.id, contentType: "image/png", size: 10 },
      s.deps
    )

    expect(key.startsWith(`listings/${s.listing.id}/`)).toBe(true)
    expect(upload.url).toContain(key)
    expect(await prisma.listingImage.count()).toBe(0)
  })

  it("rejects other types, empty and oversize declarations, and unknown fields at the request", async () => {
    const s = await setup()

    for (const bad of [
      { contentType: "image/gif", size: 10 },
      { contentType: "text/html", size: 10 },
      { contentType: "image/png", size: 0 },
      { contentType: "image/png", size: MAX_IMAGE_BYTES + 1 },
      { contentType: "image/png", size: 10, key: "listings/x/y.png" },
    ]) {
      await expect(
        requestImageUpload({ listingId: s.listing.id, ...bad }, s.deps)
      ).rejects.toBeInstanceOf(ValidationError)
    }
  })

  it("confirming checks what is really stored: nothing, the wrong type, or too big", async () => {
    const s = await setup()
    const ask = async (type: "image/png" = "image/png") =>
      (
        await requestImageUpload(
          { listingId: s.listing.id, contentType: type, size: 10 },
          s.deps
        )
      ).key

    const missing = await ask()

    await expect(
      confirmImageUpload({ listingId: s.listing.id, key: missing }, s.deps)
    ).rejects.toMatchObject({ details: { reason: "NOT_UPLOADED" } })

    const wrongType = await ask()

    storage.put(wrongType, new Uint8Array(10), "text/html")
    await expect(
      confirmImageUpload({ listingId: s.listing.id, key: wrongType }, s.deps)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(storage.has(wrongType)).toBe(false)

    const mismatched = await ask()

    storage.put(mismatched, new Uint8Array(10), "image/jpeg")
    await expect(
      confirmImageUpload({ listingId: s.listing.id, key: mismatched }, s.deps)
    ).rejects.toBeInstanceOf(ValidationError)

    const tooBig = await ask()

    storage.put(tooBig, new Uint8Array(MAX_IMAGE_BYTES + 1), "image/png")
    await expect(
      confirmImageUpload({ listingId: s.listing.id, key: tooBig }, s.deps)
    ).rejects.toBeInstanceOf(ValidationError)
    expect(storage.has(tooBig)).toBe(false)

    const empty = await ask()

    storage.put(empty, new Uint8Array(0), "image/png")
    await expect(
      confirmImageUpload({ listingId: s.listing.id, key: empty }, s.deps)
    ).rejects.toBeInstanceOf(ValidationError)

    expect(await prisma.listingImage.count()).toBe(0)
  })

  it("a key that is not one this listing was issued is refused, including another listing's", async () => {
    const s = await setup()
    const other = await setup()
    const foreign = `listings/${other.listing.id}/${randomUUID()}.png`

    storage.put(foreign, new Uint8Array(10), "image/png")

    for (const key of [
      foreign,
      `listings/${s.listing.id}/../${other.listing.id}/x.png`,
      `listings/${s.listing.id}/not-a-uuid.png`,
      "anything",
    ]) {
      await expect(
        confirmImageUpload({ listingId: s.listing.id, key }, s.deps)
      ).rejects.toBeInstanceOf(ValidationError)
    }

    expect(await prisma.listingImage.count()).toBe(0)
  })

  it("confirming the same upload twice records one picture", async () => {
    const s = await setup()
    const { key } = await requestImageUpload(
      { listingId: s.listing.id, contentType: "image/png", size: 10 },
      s.deps
    )

    storage.put(key, new Uint8Array(10), "image/png")

    const first = await confirmImageUpload(
      { listingId: s.listing.id, key },
      s.deps
    )
    const again = await confirmImageUpload(
      { listingId: s.listing.id, key },
      s.deps
    )

    expect(again.id).toBe(first.id)
    expect(await prisma.listingImage.count()).toBe(1)
  })

  it(`a listing holds at most ${MAX_IMAGES_PER_LISTING} pictures`, async () => {
    const s = await setup()

    for (let i = 0; i < MAX_IMAGES_PER_LISTING; i += 1) await addImage(s, 10)

    await expect(
      requestImageUpload(
        { listingId: s.listing.id, contentType: "image/png", size: 10 },
        s.deps
      )
    ).rejects.toMatchObject({ details: { reason: "TOO_MANY_IMAGES" } })
    expect(await prisma.listingImage.count()).toBe(MAX_IMAGES_PER_LISTING)
  })

  it("two uploads requested before the limit but confirmed after it: the extra is refused and deleted", async () => {
    const s = await setup()

    for (let i = 0; i < MAX_IMAGES_PER_LISTING - 1; i += 1)
      await addImage(s, 10)

    const keys = await Promise.all(
      [0, 1].map(
        async () =>
          (
            await requestImageUpload(
              { listingId: s.listing.id, contentType: "image/png", size: 10 },
              s.deps
            )
          ).key
      )
    )

    for (const key of keys) storage.put(key, new Uint8Array(10), "image/png")

    await confirmImageUpload({ listingId: s.listing.id, key: keys[0]! }, s.deps)
    await expect(
      confirmImageUpload({ listingId: s.listing.id, key: keys[1]! }, s.deps)
    ).rejects.toBeInstanceOf(ConflictError)

    expect(await prisma.listingImage.count()).toBe(MAX_IMAGES_PER_LISTING)
    expect(storage.has(keys[1]!)).toBe(false)
  })

  it("removing a picture closes the gap, deletes the object and leaves the rest in order", async () => {
    const s = await setup()
    const [a, b, c] = [await addImage(s), await addImage(s), await addImage(s)]

    await removeImage({ listingId: s.listing.id, imageId: b!.id }, s.deps)

    expect(await positions(s.listing.id)).toEqual([
      [a!.id, 0],
      [c!.id, 1],
    ])
    expect(storage.has(b!.key)).toBe(false)
    expect(storage.has(a!.key)).toBe(true)

    await removeImage({ listingId: s.listing.id, imageId: a!.id }, s.deps)
    expect(await positions(s.listing.id)).toEqual([[c!.id, 0]])
  })

  it("reordering sets the exact order, and the cover is the first", async () => {
    const s = await setup()
    const [a, b, c] = [await addImage(s), await addImage(s), await addImage(s)]
    const result = await reorderImages(
      { listingId: s.listing.id, imageIds: [c!.id, a!.id, b!.id] },
      s.deps
    )

    expect(result.map((i) => [i.id, i.position])).toEqual([
      [c!.id, 0],
      [a!.id, 1],
      [b!.id, 2],
    ])
    expect(
      (await listListingImages({ listingId: s.listing.id }, s.deps))[0]?.id
    ).toBe(c!.id)
  })

  it("a reorder that drops, repeats, adds or borrows a picture is refused and changes nothing", async () => {
    const s = await setup()
    const other = await setup()
    const [a, b] = [await addImage(s), await addImage(s)]
    const foreign = await addImage(other)
    const before = await positions(s.listing.id)

    for (const imageIds of [
      [a!.id],
      [a!.id, a!.id],
      [a!.id, b!.id, "ghost"],
      [a!.id, foreign.id],
      [b!.id, a!.id, a!.id],
    ]) {
      await expect(
        reorderImages({ listingId: s.listing.id, imageIds }, s.deps)
      ).rejects.toBeInstanceOf(ValidationError)
    }

    expect(await positions(s.listing.id)).toEqual(before)
  })

  it("another vendor cannot add, remove, reorder or list pictures, and a picture id of another listing is not found", async () => {
    const s = await setup()
    const rival = await setup()
    const image = await addImage(s)
    const theirs = { ...rival.deps }

    await expect(
      requestImageUpload(
        { listingId: s.listing.id, contentType: "image/png", size: 10 },
        theirs
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      removeImage({ listingId: s.listing.id, imageId: image.id }, theirs)
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      reorderImages({ listingId: s.listing.id, imageIds: [image.id] }, theirs)
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      listListingImages({ listingId: s.listing.id }, theirs)
    ).rejects.toBeInstanceOf(ForbiddenError)

    // Your own listing, someone else's picture id.
    await expect(
      removeImage({ listingId: rival.listing.id, imageId: image.id }, theirs)
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await prisma.listingImage.count()).toBe(1)
    expect(storage.has(image.key)).toBe(true)
  })

  it("TC-E5S1-03 for pictures: adding to a published listing sends it to review; removing or reordering does not", async () => {
    const s = await setup({ status: "DRAFT" })
    const [a, b] = [await addImage(s), await addImage(s)]

    await prisma.listing.update({
      where: { id: s.listing.id },
      data: { status: "PUBLISHED" },
    })
    expect(
      await prisma.listing.count({ where: publiclyVisibleListingWhere() })
    ).toBe(1)

    await reorderImages(
      { listingId: s.listing.id, imageIds: [b!.id, a!.id] },
      s.deps
    )
    await removeImage({ listingId: s.listing.id, imageId: a!.id }, s.deps)
    expect(
      (await prisma.listing.findUniqueOrThrow({ where: { id: s.listing.id } }))
        .status
    ).toBe("PUBLISHED")

    await addImage(s)
    expect(
      (await prisma.listing.findUniqueOrThrow({ where: { id: s.listing.id } }))
        .status
    ).toBe("PENDING_REVIEW")
    expect(
      await prisma.listing.count({ where: publiclyVisibleListingWhere() })
    ).toBe(0)
  })

  it("a listing under review is frozen for pictures, and a suspended vendor cannot change them", async () => {
    const review = await setup({ status: "PENDING_REVIEW" })

    await expect(
      requestImageUpload(
        { listingId: review.listing.id, contentType: "image/png", size: 10 },
        review.deps
      )
    ).rejects.toBeInstanceOf(ConflictError)

    const suspended = await setup({ vendorStatus: "SUSPENDED" })

    await expect(
      requestImageUpload(
        { listingId: suspended.listing.id, contentType: "image/png", size: 10 },
        suspended.deps
      )
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("removing and reordering are frozen too while a listing is under review", async () => {
    const s = await setup()
    const [a, b] = [await addImage(s), await addImage(s)]

    await prisma.listing.update({
      where: { id: s.listing.id },
      data: { status: "PENDING_REVIEW" },
    })

    await expect(
      removeImage({ listingId: s.listing.id, imageId: a!.id }, s.deps)
    ).rejects.toBeInstanceOf(ConflictError)
    await expect(
      reorderImages(
        { listingId: s.listing.id, imageIds: [b!.id, a!.id] },
        s.deps
      )
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await positions(s.listing.id)).toEqual([
      [a!.id, 0],
      [b!.id, 1],
    ])
    expect(storage.has(a!.key)).toBe(true)
  })

  it("deleting a listing deletes its picture rows", async () => {
    const s = await setup()

    await addImage(s)
    await prisma.listing.delete({ where: { id: s.listing.id } })

    expect(await prisma.listingImage.count()).toBe(0)
  })

  it("simultaneous confirmations leave contiguous positions with no duplicates", async () => {
    const s = await setup()
    const keys = await Promise.all(
      [0, 1, 2].map(
        async () =>
          (
            await requestImageUpload(
              { listingId: s.listing.id, contentType: "image/png", size: 10 },
              s.deps
            )
          ).key
      )
    )

    for (const key of keys) storage.put(key, new Uint8Array(10), "image/png")

    await Promise.all(
      keys.map((key) =>
        confirmImageUpload({ listingId: s.listing.id, key }, s.deps)
      )
    )

    expect((await positions(s.listing.id)).map(([, p]) => p)).toEqual([0, 1, 2])
  })
})
