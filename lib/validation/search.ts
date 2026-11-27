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

export type SearchQuery = z.infer<typeof searchQuerySchema>
