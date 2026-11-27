import { z } from "zod"
import { MAX_HOLD_QUANTITY } from "@/lib/validation/hold"

/** Changing how many places are held. Strict: the price is never the caller's. */
export const updateCartItemSchema = z
  .strictObject({
    holdId: z.string().trim().min(1, "Choose an item in your cart"),
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

export const removeCartItemSchema = z
  .strictObject({
    holdId: z.string().trim().min(1, "Choose an item in your cart"),
  })
  .strict()

/** How many items a visitor may add in one window (CR-8). */
export const CART_ADDS_PER_WINDOW = 20
export const CART_WINDOW_MINUTES = 10
