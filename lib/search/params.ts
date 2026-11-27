/**
 * Reads search input from a URL's query string, and builds the links back.
 * Values that are missing or not numbers are dropped rather than failing the
 * page; `searchQuerySchema` then judges what is left, so the same rules apply
 * to every entry point.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>

function text(raw: RawSearchParams, key: string): string | undefined {
  const value = raw[key]

  return typeof value === "string" ? value : undefined
}

function number(raw: RawSearchParams, key: string): number | undefined {
  const value = text(raw, key)

  if (value === undefined || value.trim() === "") return undefined

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : Number.NaN
}

/** The filter form works in pounds; the search works in whole pence (CR-5). */
function pounds(raw: RawSearchParams, key: string): number | undefined {
  const value = number(raw, key)

  if (value === undefined || Number.isNaN(value)) return value

  return Math.round(value * 100)
}

export function searchInputFromParams(
  raw: RawSearchParams
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    q: text(raw, "q"),
    category: text(raw, "category"),
    date: text(raw, "date"),
    minPrice: pounds(raw, "minPounds"),
    maxPrice: pounds(raw, "maxPounds"),
    page: number(raw, "page") ?? 1,
    south: number(raw, "south"),
    north: number(raw, "north"),
    west: number(raw, "west"),
    east: number(raw, "east"),
  }

  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key]
  }

  return input
}

/**
 * A link to /explore with the given search. Undefined, blank and NaN values
 * are left out, so the link only carries filters that are actually set.
 */
export function searchHref(input: Record<string, unknown>): string {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    if (typeof value === "string" && value === "") continue
    if (typeof value === "number" && Number.isNaN(value)) continue

    query.set(key, String(value))
  }

  const qs = query.toString()

  return qs ? `/explore?${qs}` : "/explore"
}
