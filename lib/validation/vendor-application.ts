import { z } from "zod"
import { emailSchema } from "@/lib/validation/auth"

export const VENDOR_NAME_MIN_LENGTH = 2
export const VENDOR_NAME_MAX_LENGTH = 100
export const VENDOR_DESCRIPTION_MAX_LENGTH = 1000

/** A blank form field means "not given", not an empty value. */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value

/**
 * What an applicant provides. Strict on purpose: the status, the owner and the
 * approver are never taken from the caller, so a payload naming any of them is
 * rejected, not ignored.
 */
export const vendorApplicationSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(VENDOR_NAME_MIN_LENGTH, "Enter your business name")
    .max(
      VENDOR_NAME_MAX_LENGTH,
      `Business name must be at most ${VENDOR_NAME_MAX_LENGTH} characters`
    ),
  description: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .max(
        VENDOR_DESCRIPTION_MAX_LENGTH,
        `Description must be at most ${VENDOR_DESCRIPTION_MAX_LENGTH} characters`
      )
      .optional()
  ),
  contactEmail: z.preprocess(blankToUndefined, emailSchema.optional()),
})

export type VendorApplicationInput = z.infer<typeof vendorApplicationSchema>
