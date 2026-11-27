import type { PublicListing } from "./public"

/**
 * schema.org structured data for a listing page. Only fields the site really
 * holds are included, so search engines never see invented prices or ratings.
 */
export function buildListingJsonLd(
  listing: PublicListing,
  url: string
): Record<string, unknown> {
  const offers = listing.products.map((product) => ({
    "@type": "Offer",
    name: product.name,
    price: (product.basePrice / 100).toFixed(2),
    priceCurrency: "GBP",
    availability: "https://schema.org/InStock",
  }))

  return {
    "@context": "https://schema.org",
    "@type": "TouristAttraction",
    name: listing.title,
    url,
    ...(listing.description ? { description: listing.description } : {}),
    ...(listing.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: listing.address,
            addressCountry: "GB",
          },
        }
      : {}),
    ...(listing.lat !== null && listing.lng !== null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: listing.lat,
            longitude: listing.lng,
          },
        }
      : {}),
    ...(offers.length > 0 ? { offers } : {}),
    provider: { "@type": "Organization", name: listing.vendorName },
  }
}

/**
 * JSON for a `<script type="application/ld+json">` element. `<` is escaped so no
 * value can close the script tag early.
 */
export function jsonLdScript(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}
