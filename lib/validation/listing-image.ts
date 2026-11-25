import { z } from "zod"
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/storage/limits"

const id = (message: string) => z.string().trim().min(1, message)

export const requestImageUploadSchema = z.strictObject({
  listingId: id("Choose a listing"),
  contentType: z.enum(Object.keys(IMAGE_TYPES) as [string, ...string[]], {
    error: "Upload a JPEG, PNG or WebP picture",
  }),
  size: z
    .number("Enter the file size")
    .int("Enter the file size")
    .min(1, "The file is empty")
    .max(MAX_IMAGE_BYTES, "Pictures can be at most 5 MB"),
})

export const confirmImageUploadSchema = z.strictObject({
  listingId: id("Choose a listing"),
  key: id("Missing upload"),
})

export const removeImageSchema = z.strictObject({
  listingId: id("Choose a listing"),
  imageId: id("Choose a picture"),
})

export const reorderImagesSchema = z.strictObject({
  listingId: id("Choose a listing"),
  imageIds: z
    .array(id("Choose a picture"))
    .min(1, "Choose the pictures to order"),
})

export const listImagesSchema = z.strictObject({
  listingId: id("Choose a listing"),
})
