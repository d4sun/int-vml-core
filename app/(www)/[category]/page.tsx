import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CategoryPage } from "@/components/brand/category-page"
import { toListingCards } from "@/lib/listings/card"
import { getImageStorage } from "@/lib/storage"
import { CATEGORY_CONFIG } from "@/lib/site/categories"
import { searchListings } from "@/lib/search/service"
import {
  searchInputFromParams,
  type RawSearchParams,
} from "@/lib/search/params"

// Statically render every known category slug.
export function generateStaticParams() {
  return Object.keys(CATEGORY_CONFIG).map((category) => ({ category }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category } = await params
  const config = CATEGORY_CONFIG[category]
  if (!config) return {}
  return { title: config.title, description: config.subtitle }
}

export default async function CategoryRoute({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>
  searchParams: Promise<RawSearchParams>
}) {
  const { category } = await params
  const config = CATEGORY_CONFIG[category]
  if (!config) notFound()

  const input = searchInputFromParams(await searchParams)
  const result = await searchListings({ ...input, category, q: undefined })

  return (
    <CategoryPage
      config={config}
      listings={toListingCards(result.listings, (key) =>
        getImageStorage().publicUrl(key)
      )}
      total={result.total}
    />
  )
}
