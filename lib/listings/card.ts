/** What a discovery card shows. Built from real listings, never from sample data. */
export type ListingCardData = {
  id: string
  slug: string
  title: string
  categoryName: string
  vendorName: string
  /** The cheapest active product in pence, or null when there is none. */
  fromPrice: number | null
  /** The first picture's public URL, or null when the listing has no picture. */
  imageUrl: string | null
}

/** "From £12.50", or "Price on request" when no product has a price. */
export function formatFromPrice(pence: number | null): string {
  if (pence === null) return "Price on request"

  return `From £${(pence / 100).toFixed(2)}`
}

/** The slice of a search result a card needs. */
export type CardSource = {
  id: string
  slug: string
  title: string
  categoryName: string
  vendorName: string
  fromPrice: number | null
  imageKey: string | null
}

/** Turns search results into cards, resolving each picture's public URL. */
export function toListingCards(
  rows: CardSource[],
  imageUrlFor: (key: string) => string
): ListingCardData[] {
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    categoryName: row.categoryName,
    vendorName: row.vendorName,
    fromPrice: row.fromPrice,
    imageUrl: row.imageKey ? imageUrlFor(row.imageKey) : null,
  }))
}
