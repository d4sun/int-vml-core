import { describe, expect, it } from "vitest"
import { FakeStorage } from "@/lib/storage/fake"
import { createImageStorage } from "@/lib/storage"
import {
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  imageKey,
  isImageContentType,
  isKeyOfListing,
} from "@/lib/storage/limits"
import { S3Storage } from "@/lib/storage/s3"
import {
  confirmImageUploadSchema,
  reorderImagesSchema,
  requestImageUploadSchema,
} from "@/lib/validation/listing-image"

const ID = "123e4567-e89b-42d3-a456-426614174000"
const LISTING = "listing-1"

describe("limits", () => {
  it("allows only JPEG, PNG and WebP", () => {
    expect(Object.keys(IMAGE_TYPES).sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ])

    for (const ok of Object.keys(IMAGE_TYPES)) {
      expect(isImageContentType(ok)).toBe(true)
    }

    for (const bad of [
      "image/gif",
      "image/svg+xml",
      "text/html",
      "application/pdf",
      "IMAGE/PNG",
      "image/png; charset=x",
      "",
      "constructor",
      "__proto__",
      null,
      undefined,
      42,
    ]) {
      expect(isImageContentType(bad), String(bad)).toBe(false)
    }
  })

  it("keys are built by the server under the listing's own prefix", () => {
    expect(imageKey(LISTING, ID, "image/png")).toBe(
      `listings/${LISTING}/${ID}.png`
    )
    expect(imageKey(LISTING, ID, "image/jpeg")).toBe(
      `listings/${LISTING}/${ID}.jpg`
    )
    expect(imageKey(LISTING, ID, "image/webp")).toBe(
      `listings/${LISTING}/${ID}.webp`
    )
  })

  it("only an exact key of this listing is accepted", () => {
    const own = imageKey(LISTING, ID, "image/png")

    expect(isKeyOfListing(own, LISTING)).toBe(true)
    expect(isKeyOfListing(own, "listing-2")).toBe(false)

    for (const bad of [
      `listings/${LISTING}/../listing-2/${ID}.png`,
      `listings/${LISTING}/${ID}.exe`,
      `listings/${LISTING}/${ID}.png/extra`,
      `listings/${LISTING}/evil.png`,
      `listings/${LISTING}/${ID}.PNG`,
      `other/${LISTING}/${ID}.png`,
      `listings/${LISTING}/`,
      "",
    ]) {
      expect(isKeyOfListing(bad, LISTING), bad).toBe(false)
    }
  })
})

describe("image schemas", () => {
  const upload = (over: Record<string, unknown> = {}) =>
    requestImageUploadSchema.safeParse({
      listingId: "l1",
      contentType: "image/png",
      size: 1000,
      ...over,
    })

  it("bounds the declared size to 1 byte through 5 MB", () => {
    expect(upload({ size: 1 }).success).toBe(true)
    expect(upload({ size: MAX_IMAGE_BYTES }).success).toBe(true)

    for (const size of [0, -1, MAX_IMAGE_BYTES + 1, 1.5, "1000", NaN, null]) {
      expect(upload({ size }).success, String(size)).toBe(false)
    }
  })

  it("refuses other types and unknown fields", () => {
    expect(upload({ contentType: "image/gif" }).success).toBe(false)
    expect(upload({ contentType: "text/html" }).success).toBe(false)
    expect(upload({ key: "listings/x/y.png" }).success).toBe(false)
  })

  it("confirm and reorder need their fields", () => {
    expect(
      confirmImageUploadSchema.safeParse({ listingId: "l", key: "k" }).success
    ).toBe(true)
    expect(confirmImageUploadSchema.safeParse({ listingId: "l" }).success).toBe(
      false
    )
    expect(
      reorderImagesSchema.safeParse({ listingId: "l", imageIds: ["a"] }).success
    ).toBe(true)
    expect(
      reorderImagesSchema.safeParse({ listingId: "l", imageIds: [] }).success
    ).toBe(false)
  })
})

describe("S3Storage", () => {
  const base = {
    bucket: "vml-pictures",
    region: "eu-west-2",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
    publicBaseUrl: "https://cdn.example.com/",
    now: () => new Date("2026-11-25T10:00:00Z"),
  }
  const key = imageKey(LISTING, ID, "image/png")

  it("signs a PUT for the bucket's own host, pinned to the content type", async () => {
    const target = await new S3Storage(base).createUploadTarget({
      key,
      contentType: "image/png",
    })
    const url = new URL(target.url)

    expect(url.host).toBe("vml-pictures.s3.eu-west-2.amazonaws.com")
    expect(url.pathname).toBe(`/${key}`)
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host"
    )
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600")
    expect(url.searchParams.get("X-Amz-Credential")).toBe(
      "AKIAEXAMPLE/20261125/eu-west-2/s3/aws4_request"
    )
    expect(target.method).toBe("PUT")
    expect(target.headers).toEqual({ "Content-Type": "image/png" })
    expect(target.expiresAt.toISOString()).toBe("2026-11-25T10:10:00.000Z")
  })

  it("uses path-style addressing for an S3-compatible endpoint", async () => {
    const target = await new S3Storage({
      ...base,
      endpoint: "http://localhost:9000",
    }).createUploadTarget({ key, contentType: "image/png" })
    const url = new URL(target.url)

    expect(url.protocol).toBe("http:")
    expect(url.host).toBe("localhost:9000")
    expect(url.pathname).toBe(`/vml-pictures/${key}`)
  })

  it("never signs the secret into the URL", async () => {
    const target = await new S3Storage(base).createUploadTarget({
      key,
      contentType: "image/png",
    })

    expect(target.url).not.toContain("secret")
  })

  function withFetch(responses: Response[]) {
    const calls: { url: string; method: string }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" })

      return responses.shift() ?? new Response(null, { status: 500 })
    }

    return { calls, storage: new S3Storage({ ...base, fetch: fetchImpl }) }
  }

  it("reads size and type with a signed HEAD", async () => {
    const t = withFetch([
      new Response(null, {
        status: 200,
        headers: { "content-length": "1234", "content-type": "image/png" },
      }),
    ])

    expect(await t.storage.head(key)).toEqual({
      size: 1234,
      contentType: "image/png",
    })
    expect(t.calls[0]?.method).toBe("HEAD")
    expect(
      new URL(t.calls[0]!.url).searchParams.get("X-Amz-Signature")
    ).toMatch(/^[0-9a-f]{64}$/)
  })

  it("a missing object is null; any other failure throws", async () => {
    expect(
      await withFetch([new Response(null, { status: 404 })]).storage.head(key)
    ).toBeNull()
    await expect(
      withFetch([new Response(null, { status: 403 })]).storage.head(key)
    ).rejects.toThrow("403")
  })

  it("delete signs a DELETE, tolerates a missing object and fails on errors", async () => {
    const ok = withFetch([new Response(null, { status: 204 })])

    await ok.storage.delete(key)
    expect(ok.calls[0]?.method).toBe("DELETE")

    await withFetch([new Response(null, { status: 404 })]).storage.delete(key)
    await expect(
      withFetch([new Response(null, { status: 500 })]).storage.delete(key)
    ).rejects.toThrow("500")
  })

  it("serves pictures from the public base URL with the key encoded", () => {
    expect(new S3Storage(base).publicUrl(key)).toBe(
      `https://cdn.example.com/${key}`
    )
    expect(new S3Storage(base).publicUrl("listings/a b/c.png")).toBe(
      "https://cdn.example.com/listings/a%20b/c.png"
    )
  })
})

describe("FakeStorage", () => {
  it("stores, reports, serves and deletes", async () => {
    const fake = new FakeStorage({ origin: "http://localhost:3000" })
    const key = imageKey(LISTING, ID, "image/png")

    expect(await fake.head(key)).toBeNull()

    fake.put(key, new Uint8Array([1, 2, 3]), "image/png")

    expect(await fake.head(key)).toEqual({ size: 3, contentType: "image/png" })
    expect(fake.publicUrl(key)).toBe(
      `http://localhost:3000/api/dev/storage/${key}`
    )

    await fake.delete(key)
    await fake.delete(key)

    expect(fake.has(key)).toBe(false)
    expect(fake.deleted).toEqual([key, key])
  })

  it("hands out an upload target on the dev route", async () => {
    const target = await new FakeStorage({
      origin: "http://x",
    }).createUploadTarget({
      key: "listings/a/b.png",
      contentType: "image/png",
    })

    expect(target.url).toBe("http://x/api/dev/storage/listings/a/b.png")
    expect(target.headers).toEqual({ "Content-Type": "image/png" })
  })
})

describe("createImageStorage", () => {
  const s3 = {
    S3_BUCKET: "b",
    S3_REGION: "eu-west-2",
    S3_ACCESS_KEY_ID: "id",
    S3_SECRET_ACCESS_KEY: "secret",
    S3_PUBLIC_BASE_URL: "https://cdn.example.com",
  }

  it("uses S3 when it is configured, even in production", () => {
    expect(createImageStorage({ NODE_ENV: "production", ...s3 }).mode).toBe(
      "s3"
    )
  })

  it("needs every S3 setting once a bucket is named", () => {
    expect(() =>
      createImageStorage({ NODE_ENV: "development", S3_BUCKET: "b" })
    ).toThrow("S3_REGION")
  })

  it("falls back to the fake outside production", () => {
    for (const NODE_ENV of ["development", "test"]) {
      expect(createImageStorage({ NODE_ENV }).mode).toBe("fake")
    }
  })

  it("never falls back to the fake in production without the explicit opt-in", () => {
    expect(() => createImageStorage({ NODE_ENV: "production" })).toThrow("S3_")
    expect(
      createImageStorage({ NODE_ENV: "production", STORAGE_ADAPTER: "fake" })
        .mode
    ).toBe("fake")
  })
})
