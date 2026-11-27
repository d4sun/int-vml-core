import { z } from "zod"

export const SEARCH_PAGE_SIZE = 24
export const SEARCH_MAX_PAGE = 1000
export const SEARCH_QUERY_MAX_LENGTH = 100
/** Prices are integer pence (CR-5). The ceiling matches the product price limit. */
export const SEARCH_MAX_PENCE = 1_000_000

const pence = z.number().int().min(0).max(SEARCH_MAX_PENCE)

/**
 * Search input. Blank text and blank category mean "no filter". A minimum
 * above the maximum is refused rather than silently returning nothing.
 */
export const searchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .max(
        SEARCH_QUERY_MAX_LENGTH,
        `Search must be at most ${SEARCH_QUERY_MAX_LENGTH} characters`
      )
      .optional()
      .transform((value) => (value ? value : undefined)),
    category: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((value) => (value ? value : undefined)),
    /** A London calendar date, YYYY-MM-DD: matches slots that start on that day. */
    date: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : undefined))
      .refine((value) => value === undefined || isRealDate(value), {
        message: "Choose a real date",
      }),
    minPrice: pence.optional(),
    maxPrice: pence.optional(),
    page: z.number().int().min(1).max(SEARCH_MAX_PAGE).default(1),
  })
  .refine(
    (value) =>
      value.minPrice === undefined ||
      value.maxPrice === undefined ||
      value.minPrice <= value.maxPrice,
    {
      message: "The minimum price cannot be more than the maximum",
      path: ["maxPrice"],
    }
  )

/** A YYYY-MM-DD string that names a real calendar day (no 31 February). */
export function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

  if (!match) return false

  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ]
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export type SearchQuery = z.infer<typeof searchQuerySchema>
