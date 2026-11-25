/** Pictures a vendor may upload, and the most one listing can hold. */
export const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const

export type ImageContentType = keyof typeof IMAGE_TYPES

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGES_PER_LISTING = 10
export const UPLOAD_URL_TTL_SECONDS = 600

export function isImageContentType(value: unknown): value is ImageContentType {
  return typeof value === "string" && Object.hasOwn(IMAGE_TYPES, value)
}

/**
 * Object keys are made here, never taken from the client: the listing id and
 * a random id, so an upload can only land under its own listing's prefix.
 */
export function imageKey(
  listingId: string,
  imageId: string,
  contentType: ImageContentType
): string {
  return `${imageKeyPrefix(listingId)}${imageId}.${IMAGE_TYPES[contentType]}`
}

export const imageKeyPrefix = (listingId: string) => `listings/${listingId}/`

/** True only for a key of the exact shape `imageKey` produces for this listing. */
export function isKeyOfListing(key: string, listingId: string): boolean {
  const prefix = imageKeyPrefix(listingId)

  return (
    key.startsWith(prefix) &&
    /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key.slice(prefix.length))
  )
}
