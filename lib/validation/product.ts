import { z } from "zod"
import { DEFAULT_POLICY, POLICY_BOUNDS } from "@/lib/products/policy"

export const PRODUCT_NAME_MIN_LENGTH = 2
export const PRODUCT_NAME_MAX_LENGTH = 120
/** Stripe's smallest GBP charge. */
export const MIN_PRICE_PENCE = 30
export const MAX_PRICE_PENCE = 1_000_000

const id = (message: string) => z.string().trim().min(1, message)

const name = z
  .string()
  .trim()
  .min(
    PRODUCT_NAME_MIN_LENGTH,
    `Name must be at least ${PRODUCT_NAME_MIN_LENGTH} characters`
  )
  .max(
    PRODUCT_NAME_MAX_LENGTH,
    `Name must be at most ${PRODUCT_NAME_MAX_LENGTH} characters`
  )

/** Integer pence, never a float (CR-5). */
const price = z
  .number("Enter a price")
  .int("Enter the price in whole pence")
  .min(MIN_PRICE_PENCE, "The smallest price is 30p")
  .max(MAX_PRICE_PENCE, "The largest price is £10,000")

const hours = (label: string, bounds: { min: number; max: number }) =>
  z
    .number("Enter a number of hours")
    .int("Use a whole number of hours")
    .min(bounds.min, `${label} cannot be less than ${bounds.min} hours`)
    .max(bounds.max, `${label} cannot be more than ${bounds.max} hours`)

export const policySchema = z.strictObject({
  cancelWindowHours: hours(
    "The cancellation window",
    POLICY_BOUNDS.cancelWindowHours
  ),
  bookingCutoffHours: hours(
    "The booking cut-off",
    POLICY_BOUNDS.bookingCutoffHours
  ),
})

/**
 * The caller names the listing and the content. The currency, kind, active
 * flag and ids are never accepted from the client (strict object).
 */
export const createProductSchema = z.strictObject({
  listingId: id("Choose a listing"),
  name,
  basePrice: price,
  policy: policySchema.default({ ...DEFAULT_POLICY }),
})

export const updateProductSchema = z
  .strictObject({
    id: id("Choose a product"),
    name: name.optional(),
    basePrice: price.optional(),
    policy: policySchema.optional(),
    active: z.boolean("Choose on or off").optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== "id"), {
    message: "Nothing to change",
  })

export const deleteProductSchema = z.strictObject({
  id: id("Choose a product"),
})
export const listProductsSchema = z.strictObject({
  listingId: id("Choose a listing"),
})

export type CreateProductInput = z.infer<typeof createProductSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
