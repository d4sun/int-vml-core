import { z } from "zod"

/**
 * An admin's refund of part or all of one booking item. The amount is in
 * pence and must be a whole, positive number; whether it fits what is still
 * refundable is checked against the database, not here. Strict: nothing else
 * (such as a commission or a status) can be set through this path.
 */
export const requestRefundSchema = z.strictObject({
  bookingItemId: z.string().trim().min(1, "Choose a booking item"),
  amount: z
    .number("Enter an amount")
    .int("Use a whole number of pence")
    .positive("The refund must be more than £0.00"),
  reason: z
    .string()
    .trim()
    .max(500, "Keep the reason to 500 characters")
    .optional()
    .transform((value) => (value ? value : undefined)),
})

export type RequestRefundInput = z.infer<typeof requestRefundSchema>
