import { ChevronDown, X } from "lucide-react"
import { PageHero } from "@/components/brand/page-hero"
import { CategoryPills } from "@/components/brand/category-pills"
import { FilterSidebar } from "@/components/brand/filter-sidebar"
import { ListingCard } from "@/components/brand/listing-card"
import { Pagination } from "@/components/brand/pagination"
import { VideoBand } from "@/components/brand/video-band"
import { NearbyRail } from "@/components/brand/nearby-rail"
import { NewsletterCta } from "@/components/brand/newsletter-cta"
import { SAMPLE_LISTINGS, type CategoryConfig } from "@/lib/mock-data"

/** The shared template behind every category page (Arts, Events, Food, Stay…). */
export function CategoryPage({ config, activePill }: { config: CategoryConfig; activePill?: string }) {
  // Repeat the sample listings to fill the grid for the UI pass.
  const listings = [...SAMPLE_LISTINGS, ...SAMPLE_LISTINGS].slice(0, 12)

  return (
    <>
      <PageHero
        title={config.title}
        subtitle={config.subtitle}
        breadcrumb={[...config.breadcrumb, config.title]}
        image={config.heroImage}
      />

      <div className="bg-white py-8">
        <CategoryPills activeHref={activePill ?? `/${config.slug}`} />
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-6 sm:px-6">
        <div className="flex flex-col gap-8 lg:flex-row">
          <FilterSidebar facets={config.facets} showPlaces={config.showPlaces} />

          <div className="min-w-0 flex-1">
            {/* Active filter chips + result count + sort */}
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <FilterChip label="Central London" />
              <FilterChip label="Hidden London" />
            </div>
            <div className="mb-5 flex items-center justify-between">
              <p className="text-sm text-vml-ink">
                <span className="font-bold text-vml-navy">145</span> place to explore
              </p>
              <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-vml-ink">
                Recommended <ChevronDown className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((l, i) => (
                <ListingCard key={`${l.id}-${i}`} listing={l} />
              ))}
            </div>

            <Pagination />
          </div>
        </div>
      </div>

      <VideoBand />
      <NearbyRail />
      <NewsletterCta />
    </>
  )
}

function FilterChip({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-sm text-vml-ink">
      {label}
      <button aria-label={`Remove ${label}`} className="text-muted-foreground hover:text-vml-red">
        <X className="size-3.5" />
      </button>
    </span>
  )
}
