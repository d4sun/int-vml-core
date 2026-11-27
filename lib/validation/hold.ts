import { z } from "zod"

/** How long a hold keeps places for a visitor's checkout (E2-S1). */
export const HOLD_TTL_MINUTES = 10
/** A visitor may hold at most this many places on one slot at once. */
export const MAX_HOLD_QUANTITY = 10

/** Strict: the server decides the time and the price, not the caller. */
export const placeHoldSchema = z
  .strictObject({
    availabilityId: z.string().trim().min(1, "Choose a time slot"),
    quantity: z
      .number()
      .int("Places must be a whole number")
      .min(1, "Choose at least one place")
      .max(
        MAX_HOLD_QUANTITY,
        `You can hold at most ${MAX_HOLD_QUANTITY} places`
      ),
  })
  .strict()

export type PlaceHoldInput = z.infer<typeof placeHoldSchema>
