import { z } from "zod"
import { MAX_CAPACITY } from "@/lib/validation/slot-rule"
import { MAX_PRICE_PENCE, MIN_PRICE_PENCE } from "@/lib/validation/product"

const id = (message: string) => z.string().trim().min(1, message)

const capacity = z
  .number("Enter a number of places")
  .int("Use a whole number of places")
  .min(1, "A slot needs at least 1 place")
  .max(MAX_CAPACITY, `A slot has at most ${MAX_CAPACITY} places`)

/** A per-slot price in integer pence; `null` removes the override. */
const priceOverride = z
  .number("Enter a price")
  .int("Enter the price in whole pence")
  .min(MIN_PRICE_PENCE, "The smallest price is 30p")
  .max(MAX_PRICE_PENCE, "The largest price is £10,000")
  .nullable()

/** The rule itself is read by the availability module, not here. */
export const createSlotsSchema = z.strictObject({
  productId: id("Choose a product"),
  rule: z.unknown(),
})

export const updateSlotSchema = z
  .strictObject({
    id: id("Choose a slot"),
    capacity: capacity.optional(),
    priceOverride: priceOverride.optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== "id"), {
    message: "Nothing to change",
  })

export const setSlotClosedSchema = z.strictObject({
  id: id("Choose a slot"),
  closed: z.boolean("Choose open or closed"),
})

export const deleteSlotSchema = z.strictObject({ id: id("Choose a slot") })

export const listSlotsSchema = z.strictObject({
  productId: id("Choose a product"),
  /** Include slots that have already started (read-only history). */
  includePast: z.boolean().optional(),
})
