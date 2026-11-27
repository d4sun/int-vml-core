import type { Metadata } from "next"
import Link from "next/link"
import { ListingCard } from "@/components/brand/listing-card"
import { ValidationError } from "@/lib/errors"
import { toListingCards } from "@/lib/listings/card"
import {
  searchInputFromParams,
  type RawSearchParams,
} from "@/lib/search/params"
import { searchListings, type SearchPage } from "@/lib/search/service"
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
  const input = searchInputFromParams(await searchParams)

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

  return (
    <main className="mx-auto max-w-[1410px] px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-vml-ink">Explore London</h1>

      {refused ? (
        <p role="alert" className="mt-4 text-sm font-medium text-destructive">
          Check the search filters and try again.
        </p>
      ) : page ? (
        <p
          className="mt-2 text-sm text-muted-foreground"
          data-testid="explore-count"
        >
          {page.total} {page.total === 1 ? "place" : "places"}
          {input.q ? ` matching “${input.q}”` : ""}
        </p>
      ) : null}

      {page && page.listings.length === 0 && !refused ? (
        <p className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No places match these filters yet.
        </p>
      ) : null}

      {page && page.listings.length > 0 ? (
        <ul
          data-testid="explore-results"
          className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {toListingCards(page.listings, (key) =>
            getImageStorage().publicUrl(key)
          ).map((listing) => (
            <li key={listing.id}>
              <ListingCard listing={listing} />
            </li>
          ))}
        </ul>
      ) : null}

      {page && totalPages > 1 ? (
        <nav
          aria-label="Pages"
          className="mt-8 flex items-center justify-between text-sm"
        >
          {current > 1 ? (
            <Link
              href={pageHref(input, current - 1)}
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
              href={pageHref(input, current + 1)}
              className="text-vml-navy hover:underline"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </main>
  )
}

/** The same search, on another page, as a relative link. */
function pageHref(input: Record<string, unknown>, page: number): string {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries({ ...input, page })) {
    if (value === undefined) continue
    if (typeof value === "string" && value === "") continue
    if (typeof value === "number" && Number.isNaN(value)) continue

    query.set(key, String(value))
  }

  return `/explore?${query.toString()}`
}
