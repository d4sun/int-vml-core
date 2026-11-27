import { ChevronDown, X } from "lucide-react"
import { PageHero } from "@/components/brand/page-hero"
import { CategoryPills } from "@/components/brand/category-pills"
import { FilterSidebar } from "@/components/brand/filter-sidebar"
import { ListingCard } from "@/components/brand/listing-card"
import { Pagination } from "@/components/brand/pagination"
import { VideoBand } from "@/components/brand/video-band"
import { NewsletterCta } from "@/components/brand/newsletter-cta"
import type { CategoryConfig } from "@/lib/site/categories"
import type { ListingCardData } from "@/lib/listings/card"

/** The shared template behind every category page (Arts, Events, Food, Stay…). */
export function CategoryPage({
  config,
  activePill,
  listings,
  total,
}: {
  config: CategoryConfig
  activePill?: string
  listings: ListingCardData[]
  total: number
}) {
  // Append the title only when it isn't already the last breadcrumb crumb.
  const breadcrumb =
    config.breadcrumb[config.breadcrumb.length - 1] === config.title
      ? config.breadcrumb
      : [...config.breadcrumb, config.title]

  return (
    <>
      <PageHero
        title={config.title}
        subtitle={config.subtitle}
        breadcrumb={breadcrumb}
        image={config.heroImage}
      />

      <div className="bg-white py-8">
        <CategoryPills activeHref={activePill ?? `/${config.slug}`} />
      </div>

      <div className="mx-auto max-w-[1410px] px-4 pb-6 sm:px-6">
        <div className="flex flex-col gap-8 lg:flex-row">
          <FilterSidebar
            facets={config.facets}
            showPlaces={config.showPlaces}
          />

          <div className="min-w-0 flex-1">
            {/* Active filter chips + result count + sort */}
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <FilterChip label="Central London" />
              <FilterChip label="Hidden London" />
            </div>
            <div className="mb-5 flex items-center justify-between">
              <p className="text-sm text-vml-ink">
                <span className="font-bold text-vml-navy">{total}</span>{" "}
                {total === 1 ? "place" : "places"} to explore
              </p>
              <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-vml-ink">
                Recommended <ChevronDown className="size-4" />
              </button>
            </div>

            {listings.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Nothing here yet. New places appear once they have been
                approved.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {listings.map((l) => (
                  <ListingCard key={l.id} listing={l} />
                ))}
              </div>
            )}

            <Pagination />
          </div>
        </div>
      </div>

      <VideoBand />
      <NewsletterCta />
    </>
  )
}

function FilterChip({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-sm text-vml-ink">
      {label}
      <button
        aria-label={`Remove ${label}`}
        className="text-muted-foreground hover:text-vml-red"
      >
        <X className="size-3.5" />
      </button>
    </span>
  )
}
