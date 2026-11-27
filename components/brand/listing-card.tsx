import Link from "next/link"
import Image from "next/image"
import { ArrowRight, Heart } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatFromPrice, type ListingCardData } from "@/lib/listings/card"

/** The standard discovery card used in the category and explore grids. */
export function ListingCard({ listing }: { listing: ListingCardData }) {
  const href = `/listings/${listing.slug}`

  return (
    <article className="group overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {listing.imageUrl ? (
          <Image
            src={listing.imageUrl}
            alt={listing.title}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}
        <button
          aria-label="Save"
          className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-white/90 text-vml-ink shadow-sm backdrop-blur transition-colors hover:text-vml-red"
        >
          <Heart className="size-4" />
        </button>
      </div>
      <div className="p-4">
        <Badge variant="eyebrow">{listing.categoryName.toUpperCase()}</Badge>
        <h3 className="mt-1 text-base font-bold text-vml-ink">
          <Link href={href} className="hover:text-vml-red">
            {listing.title}
          </Link>
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {listing.vendorName}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <Badge variant="green">{formatFromPrice(listing.fromPrice)}</Badge>
          <Link
            href={href}
            className="flex items-center gap-1 text-sm font-medium text-vml-green hover:underline"
          >
            View <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </article>
  )
}
