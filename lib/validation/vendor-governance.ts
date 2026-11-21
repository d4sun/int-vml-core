import { z } from "zod"
import { REASON_REQUIRED, VENDOR_ACTIONS } from "@/lib/vendors/transitions"

export const REASON_MAX_LENGTH = 500

/**
 * Strict on purpose: the caller names an action, never a target status, and
 * anything else (a `status`, an `approvedByAdminId`) is rejected, not ignored.
 */
export const vendorTransitionSchema = z
  .strictObject({
    vendorId: z.string().trim().min(1, "Choose a vendor"),
    action: z.enum(VENDOR_ACTIONS),
    reason: z
      .string()
      .trim()
      .max(
        REASON_MAX_LENGTH,
        `Reason must be at most ${REASON_MAX_LENGTH} characters`
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (REASON_REQUIRED.includes(value.action) && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: `Give a reason to ${value.action} a vendor`,
      })
    }
  })

export type VendorTransitionInput = z.infer<typeof vendorTransitionSchema>
