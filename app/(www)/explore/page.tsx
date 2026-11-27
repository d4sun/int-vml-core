import type { Metadata } from "next"
import Link from "next/link"
import { ListingCard } from "@/components/brand/listing-card"
import {
  SearchFilters,
  type AppliedFilters,
} from "@/components/search/search-filters"
import { SearchMapSection } from "@/components/search/search-map-section"
import { ValidationError } from "@/lib/errors"
import { toListingCards } from "@/lib/listings/card"
import {
  searchHref,
  searchInputFromParams,
  type RawSearchParams,
} from "@/lib/search/params"
import {
  listSearchCategories,
  searchListings,
  type SearchPage,
} from "@/lib/search/service"
import { getImageStorage } from "@/lib/storage"

export const metadata: Metadata = {
  title: "Explore London",
  description:
    "Find approved tours, attractions and experiences across London, with live prices.",
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const raw = await searchParams
  const input = searchInputFromParams(raw)
  const categories = await listSearchCategories()

  let page: SearchPage | null = null
  let refused = false

  try {
    page = await searchListings(input)
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    refused = true
  }

  const totalPages = page
    ? Math.max(1, Math.ceil(page.total / page.pageSize))
    : 1
  const current = page?.page ?? 1
  const storage = getImageStorage()

  const applied: AppliedFilters = {
    q: typeof input.q === "string" ? input.q : undefined,
    category: typeof input.category === "string" ? input.category : undefined,
    date: typeof input.date === "string" ? input.date : undefined,
    minPounds:
      typeof input.minPrice === "number" ? input.minPrice / 100 : undefined,
    maxPounds:
      typeof input.maxPrice === "number" ? input.maxPrice / 100 : undefined,
    area: areaOf(input),
  }

  const pins = (page?.listings ?? [])
    .filter((row) => row.lat !== null && row.lng !== null)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      lat: row.lat as number,
      lng: row.lng as number,
      fromPrice: row.fromPrice,
    }))

  const cards = page
    ? toListingCards(page.listings, (key) => storage.publicUrl(key))
    : []

  return (
    <main className="mx-auto max-w-[1410px] px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-vml-ink">Explore London</h1>

      <div className="mt-6">
        <SearchFilters categories={categories} applied={applied} />
      </div>

      {refused ? (
        <p role="alert" className="mt-4 text-sm font-medium text-destructive">
          Check the search filters and try again.
        </p>
      ) : page ? (
        <p
          className="mt-6 text-sm text-muted-foreground"
          data-testid="explore-count"
        >
          {page.total} {page.total === 1 ? "place" : "places"}
          {input.q ? ` matching “${input.q}”` : ""}
        </p>
      ) : null}

      {page ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div>
            <SearchMapSection
              pins={pins}
              input={input}
              area={areaBounds(input)}
            />
          </div>

          <div>
            {page.listings.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No places match these filters yet.
              </p>
            ) : (
              <ul
                data-testid="explore-results"
                className="grid grid-cols-1 gap-5 sm:grid-cols-2"
              >
                {cards.map((listing) => (
                  <li key={listing.id}>
                    <ListingCard listing={listing} />
                  </li>
                ))}
              </ul>
            )}

            {totalPages > 1 ? (
              <nav
                aria-label="Pages"
                className="mt-8 flex items-center justify-between text-sm"
              >
                {current > 1 ? (
                  <Link
                    href={searchHref({ ...input, page: current - 1 })}
                    className="text-vml-navy hover:underline"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-muted-foreground">
                  Page {current} of {totalPages}
                </span>
                {current < totalPages ? (
                  <Link
                    href={searchHref({ ...input, page: current + 1 })}
                    className="text-vml-navy hover:underline"
                  >
                    Next →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  )
}

/** The map area the search was run for, if it had one. */
function areaOf(input: Record<string, unknown>) {
  const { south, north, west, east } = input as Record<
    string,
    number | undefined
  >

  if (
    south === undefined ||
    north === undefined ||
    west === undefined ||
    east === undefined
  ) {
    return undefined
  }

  return { south, north, west, east }
}

function areaBounds(
  input: Record<string, unknown>
): [[number, number], [number, number]] | undefined {
  const area = areaOf(input)

  return area
    ? [
        [area.south, area.west],
        [area.north, area.east],
      ]
    : undefined
}
