/**
 * Reads search input from a URL's query string. Values that are missing or not
 * numbers are dropped rather than failing the page; `searchQuerySchema` then
 * judges what is left, so the same rules apply to every entry point.
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

export function searchInputFromParams(
  raw: RawSearchParams
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    q: text(raw, "q"),
    category: text(raw, "category"),
    date: text(raw, "date"),
    minPrice: number(raw, "minPrice"),
    maxPrice: number(raw, "maxPrice"),
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
