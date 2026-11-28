import { z } from "zod"

export const MAX_CHECKOUT_HOLDS = 50

/**
 * The visitor names which holds to buy. Strict on purpose: prices, totals,
 * vendors and commission are the server's to decide (IT-19, TC-E2S2-06), so a
 * caller that sends any of them is refused rather than trusted.
 */
export const checkoutSchema = z
  .strictObject({
    holdIds: z
      .array(z.string().trim().min(1, "Choose an item in your cart"))
      .min(1, "Your cart is empty")
      .max(
        MAX_CHECKOUT_HOLDS,
        `Check out at most ${MAX_CHECKOUT_HOLDS} items at once`
      ),
  })
  .refine((value) => new Set(value.holdIds).size === value.holdIds.length, {
    message: "Each item may appear once",
    path: ["holdIds"],
  })

export type CheckoutInput = z.infer<typeof checkoutSchema>
