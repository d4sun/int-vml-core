import { z } from "zod"

export const LISTING_TITLE_MIN_LENGTH = 3
export const LISTING_TITLE_MAX_LENGTH = 120
export const LISTING_DESCRIPTION_MAX_LENGTH = 5000
export const LISTING_ADDRESS_MAX_LENGTH = 200

const id = (message: string) => z.string().trim().min(1, message)

const title = z
  .string()
  .trim()
  .min(
    LISTING_TITLE_MIN_LENGTH,
    `Title must be at least ${LISTING_TITLE_MIN_LENGTH} characters`
  )
  .max(
    LISTING_TITLE_MAX_LENGTH,
    `Title must be at most ${LISTING_TITLE_MAX_LENGTH} characters`
  )

/** Blank means "none": stored as null, never as an empty string. */
const text = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .transform((value) => (value === "" ? null : value))

const lat = z
  .number("Enter a number")
  .min(-90, "Latitude must be between -90 and 90")
  .max(90, "Latitude must be between -90 and 90")
const lng = z
  .number("Enter a number")
  .min(-180, "Longitude must be between -180 and 180")
  .max(180, "Longitude must be between -180 and 180")

/** A location is both coordinates or neither, never one. */
function pairOrNone(
  value: { lat?: number | null | undefined; lng?: number | null | undefined },
  ctx: z.RefinementCtx
) {
  if ((value.lat === undefined) !== (value.lng === undefined)) {
    ctx.addIssue({
      code: "custom",
      path: [value.lat === undefined ? "lat" : "lng"],
      message: "Give both latitude and longitude, or neither",
    })
  }
}

/**
 * The caller names the vendor and the content. The status, slug, images and
 * owner of a listing are never accepted from the client (strict object).
 */
export const createListingSchema = z
  .strictObject({
    vendorId: id("Choose a vendor"),
    title,
    categoryId: id("Choose a category"),
    description: text(LISTING_DESCRIPTION_MAX_LENGTH, "Description").optional(),
    address: text(LISTING_ADDRESS_MAX_LENGTH, "Address").optional(),
    lat: lat.optional(),
    lng: lng.optional(),
  })
  .superRefine(pairOrNone)

/**
 * Partial: an absent field is left alone. `null` (or blank text) clears
 * description, address and the location.
 */
export const updateListingSchema = z
  .strictObject({
    id: id("Choose a listing"),
    title: title.optional(),
    categoryId: id("Choose a category").optional(),
    description: text(LISTING_DESCRIPTION_MAX_LENGTH, "Description").optional(),
    address: text(LISTING_ADDRESS_MAX_LENGTH, "Address").optional(),
    lat: lat.nullable().optional(),
    lng: lng.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.lat === undefined) !== (value.lng === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [value.lat === undefined ? "lat" : "lng"],
        message: "Give both latitude and longitude, or neither",
      })
    } else if ((value.lat === null) !== (value.lng === null)) {
      ctx.addIssue({
        code: "custom",
        path: [value.lat === null ? "lng" : "lat"],
        message: "Clear both latitude and longitude, or neither",
      })
    }
  })
  .refine((value) => Object.keys(value).some((key) => key !== "id"), {
    message: "Nothing to change",
  })

export const submitListingSchema = z.strictObject({
  id: id("Choose a listing"),
})

export type CreateListingInput = z.infer<typeof createListingSchema>
export type UpdateListingInput = z.infer<typeof updateListingSchema>
