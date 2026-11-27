import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { NearbyRail } from "@/components/brand/nearby-rail"
import { formatFromPrice, toListingCards } from "@/lib/listings/card"
import { buildListingJsonLd, jsonLdScript } from "@/lib/listings/json-ld"
import { getPublicListing } from "@/lib/listings/public"
import { searchListings } from "@/lib/search/service"
import { getImageStorage } from "@/lib/storage"

/** How far (degrees, roughly 1 km) "nearby" reaches around a listing. */
const NEARBY_DEGREES = 0.01

const appUrl = () =>
  (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "")

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const listing = await getPublicListing(slug)

  if (!listing) return { title: "Not found" }

  return {
    title: listing.title,
    description:
      listing.description?.slice(0, 160) ??
      `${listing.title} in London, ${listing.vendorName}.`,
    alternates: { canonical: `/listings/${listing.slug}` },
  }
}

export default async function ListingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const listing = await getPublicListing(slug)

  if (!listing) notFound()

  const url = `${appUrl()}/listings/${listing.slug}`
  const storage = getImageStorage()

  const nearby =
    listing.lat !== null && listing.lng !== null
      ? await searchListings({
          south: listing.lat - NEARBY_DEGREES,
          north: listing.lat + NEARBY_DEGREES,
          west: listing.lng - NEARBY_DEGREES,
          east: listing.lng + NEARBY_DEGREES,
        })
      : null

  const nearbyCards = nearby
    ? toListingCards(
        nearby.listings.filter((row) => row.id !== listing.id).slice(0, 8),
        (key) => storage.publicUrl(key)
      )
    : []

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(buildListingJsonLd(listing, url)),
        }}
      />

      <main className="mx-auto max-w-[1410px] px-4 py-8 sm:px-6">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/explore" className="hover:underline">
            Explore
          </Link>
          {" / "}
          <span>{listing.categoryName}</span>
        </nav>

        <header className="mt-3">
          <p className="text-xs font-bold tracking-widest text-vml-red uppercase">
            {listing.categoryName}
          </p>
          <h1 className="mt-1 text-3xl font-bold text-vml-ink">
            {listing.title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Offered by {listing.vendorName}
            {listing.address ? ` · ${listing.address}` : ""}
          </p>
        </header>

        {listing.imageKeys.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {listing.imageKeys.map((key, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={key}
                src={storage.publicUrl(key)}
                alt={index === 0 ? listing.title : ""}
                className="aspect-[4/3] w-full rounded-xl object-cover"
              />
            ))}
          </div>
        ) : null}

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
          <section aria-labelledby="about">
            <h2 id="about" className="text-lg font-bold text-vml-ink">
              About
            </h2>
            <p className="mt-3 text-sm whitespace-pre-line text-vml-ink">
              {listing.description ??
                "The vendor has not added a description yet."}
            </p>
          </section>

          <aside
            aria-labelledby="tickets"
            className="h-fit rounded-2xl border border-border bg-card p-5"
          >
            <h2 id="tickets" className="text-lg font-bold text-vml-ink">
              Tickets
            </h2>
            {listing.products.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Nothing is on sale right now.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border text-sm">
                {listing.products.map((product) => (
                  <li
                    key={product.id}
                    className="flex items-start justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="font-semibold text-vml-ink">
                        {product.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {product.cancelWindowHours > 0
                          ? `Free cancellation up to ${product.cancelWindowHours} hours before`
                          : "Non-refundable"}
                      </p>
                    </div>
                    <p className="font-semibold text-vml-green">
                      {formatFromPrice(product.basePrice)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </main>

      <NearbyRail
        title="Nearby"
        subtitle={`Other places within about a kilometre of ${listing.title}`}
        items={nearbyCards}
      />
    </>
  )
}
