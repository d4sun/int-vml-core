import { z } from "zod"
import { MAX_COMMISSION_BPS } from "@/lib/validation/category"

/**
 * An admin's commission for one vendor. `null` clears the override, so the
 * vendor's sales fall back to each category's default. Strict: nothing else
 * (such as a rate for a category) can be set through this path.
 */
export const setVendorCommissionSchema = z.strictObject({
  vendorId: z.string().trim().min(1, "Choose a vendor"),
  commissionBps: z
    .number("Enter a number")
    .int("Use a whole number of basis points")
    .min(0, "Commission cannot be negative")
    .max(MAX_COMMISSION_BPS, "Commission cannot be more than 100%")
    .nullable(),
})

export type SetVendorCommissionInput = z.infer<typeof setVendorCommissionSchema>
