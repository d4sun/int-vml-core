import { z } from "zod"
import { RESERVED_CATEGORY_SLUGS, SLUG_PATTERN } from "@/lib/categories/slug"

export const CATEGORY_NAME_MAX_LENGTH = 80
export const MAX_COMMISSION_BPS = 10_000

const name = z
  .string()
  .trim()
  .min(1, "Enter a name")
  .max(
    CATEGORY_NAME_MAX_LENGTH,
    `Name must be at most ${CATEGORY_NAME_MAX_LENGTH} characters`
  )

const slug = z
  .string()
  .trim()
  .min(1, "Enter a slug")
  .max(60, "Slug must be at most 60 characters")
  .regex(SLUG_PATTERN, "Use lower-case letters, numbers and single hyphens")
  .refine((value) => !RESERVED_CATEGORY_SLUGS.has(value), {
    message: "That slug is used by a page of the site",
  })

/** Basis points: 1000 is 10%. Whole numbers only, never a float. */
const commissionBps = z
  .number("Enter a number")
  .int("Use a whole number of basis points")
  .min(0, "Commission cannot be negative")
  .max(MAX_COMMISSION_BPS, "Commission cannot be more than 100%")

/** Only timed-slot categories exist for now; other types are reserved. */
const type = z.literal("TIMED_SLOT", {
  error: "Only timed-slot categories are supported for now",
})

const id = z.string().trim().min(1, "Choose a category")

export const createCategorySchema = z.strictObject({
  name,
  slug: slug.optional(),
  parentId: id.nullable().optional(),
  type: type.default("TIMED_SLOT"),
  commissionBpsDefault: commissionBps.default(1000),
})

/**
 * Strict and partial: a field that is absent is left alone, `parentId: null`
 * moves the category to the top level. The type is not editable: it decides
 * which products and availability a category can hold.
 */
export const updateCategorySchema = z
  .strictObject({
    id,
    name: name.optional(),
    slug: slug.optional(),
    parentId: id.nullable().optional(),
    commissionBpsDefault: commissionBps.optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== "id"), {
    message: "Nothing to change",
  })

export const deleteCategorySchema = z.strictObject({ id })

export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
