import { z } from "zod"
import { isRealDate } from "@/lib/validation/search"

export const TRIP_NAME_MAX_LENGTH = 80
export const TRIP_NOTE_MAX_LENGTH = 300

const tripName = z
  .string()
  .trim()
  .min(1, "Give the trip a name")
  .max(
    TRIP_NAME_MAX_LENGTH,
    `Keep the name to ${TRIP_NAME_MAX_LENGTH} characters`
  )

const id = z.string().trim().min(1, "Choose one")

export const createTripSchema = z.strictObject({ name: tripName })
export const renameTripSchema = z.strictObject({ tripId: id, name: tripName })
export const deleteTripSchema = z.strictObject({ tripId: id })

export const addTripItemSchema = z.strictObject({
  tripId: id,
  listingId: id,
  plannedDate: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))
    .refine((value) => value === undefined || isRealDate(value), {
      message: "Choose a real date",
    }),
  note: z
    .string()
    .trim()
    .max(
      TRIP_NOTE_MAX_LENGTH,
      `Keep the note to ${TRIP_NOTE_MAX_LENGTH} characters`
    )
    .optional()
    .transform((value) => (value ? value : undefined)),
})

export const removeTripItemSchema = z.strictObject({ itemId: id })

export const reorderTripSchema = z
  .strictObject({
    tripId: id,
    itemIds: z
      .array(id)
      .min(1, "Nothing to reorder")
      .max(200, "Too many items to reorder at once"),
  })
  .refine((value) => new Set(value.itemIds).size === value.itemIds.length, {
    message: "Each item may appear once",
    path: ["itemIds"],
  })
