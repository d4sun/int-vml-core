import { getEnv } from "../env"
import type { ImageStorage } from "./adapter"
import { FakeStorage } from "./fake"
import { S3Storage } from "./s3"

export type StorageEnv = Record<string, string | undefined>

export type StorageSelection = { storage: ImageStorage; mode: "s3" | "fake" }

/**
 * Chooses the storage once, at first use:
 *
 * - S3 settings present → S3 (all of bucket, region, keys and public URL).
 * - none in production → hard failure; the fake keeps pictures in memory and
 *   its upload route is open, so it must never be the default there. The only
 *   exception is an explicit `STORAGE_ADAPTER=fake`, which the e2e suite sets
 *   to run a production build.
 * - none elsewhere → the in-memory fake.
 */
export function createImageStorage(
  env: StorageEnv = getEnv()
): StorageSelection {
  if (env.S3_BUCKET) {
    if (
      !env.S3_REGION ||
      !env.S3_ACCESS_KEY_ID ||
      !env.S3_SECRET_ACCESS_KEY ||
      !env.S3_PUBLIC_BASE_URL
    ) {
      throw new Error(
        "S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_PUBLIC_BASE_URL are required with S3_BUCKET"
      )
    }

    return {
      mode: "s3",
      storage: new S3Storage({
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        publicBaseUrl: env.S3_PUBLIC_BASE_URL,
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      }),
    }
  }

  if (env.NODE_ENV === "production" && env.STORAGE_ADAPTER !== "fake") {
    throw new Error("No image storage configured: set the S3_* variables")
  }

  return { mode: "fake", storage: new FakeStorage() }
}

const globalForStorage = globalThis as unknown as {
  vmlStorage?: StorageSelection
}

/** The process-wide storage, kept on `globalThis` so the fake survives reloads. */
export function getImageStorage(): ImageStorage {
  globalForStorage.vmlStorage ??= createImageStorage()

  return globalForStorage.vmlStorage.storage
}

/**
 * The in-memory fake, or `null` when S3 is in use. Decided by the recorded
 * mode, not `instanceof` (Next bundles server code per route).
 */
export function getFakeStorage(): FakeStorage | null {
  getImageStorage()

  const selection = globalForStorage.vmlStorage

  return selection?.mode === "fake" ? (selection.storage as FakeStorage) : null
}
