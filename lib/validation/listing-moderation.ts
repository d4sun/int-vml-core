import { z } from "zod"
import {
  MODERATION_ACTIONS,
  MODERATION_REASON_REQUIRED,
} from "@/lib/listings/moderation"

export const MODERATION_REASON_MAX_LENGTH = 500

/**
 * Strict on purpose: the admin names an action, never a target status, so a
 * `status` field is rejected rather than ignored.
 */
export const listingModerationSchema = z
  .strictObject({
    listingId: z.string().trim().min(1, "Choose a listing"),
    action: z.enum(MODERATION_ACTIONS),
    reason: z
      .string()
      .trim()
      .max(
        MODERATION_REASON_MAX_LENGTH,
        `Reason must be at most ${MODERATION_REASON_MAX_LENGTH} characters`
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (MODERATION_REASON_REQUIRED.includes(value.action) && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: `Give a reason to ${value.action} a listing`,
      })
    }
  })

export type ListingModerationInput = z.infer<typeof listingModerationSchema>
