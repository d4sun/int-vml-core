import type { ImageContentType } from "./limits"

/**
 * Where pictures live. Services use this interface only, so tests and local
 * runs use `fake.ts` and production uses `s3.ts` with the same contract.
 * Server-only.
 */
export type UploadTarget = {
  /** The browser PUTs the file here, with exactly these headers. */
  url: string
  method: "PUT"
  headers: Record<string, string>
  expiresAt: Date
}

export type StoredObject = { size: number; contentType: string }

export interface ImageStorage {
  createUploadTarget(input: {
    key: string
    contentType: ImageContentType
  }): Promise<UploadTarget>

  /** The stored object's size and type, or `null` when nothing is there. */
  head(key: string): Promise<StoredObject | null>

  /** Deleting something that is not there is not an error. */
  delete(key: string): Promise<void>

  /** Where a visitor's browser loads the picture from. */
  publicUrl(key: string): string
}
