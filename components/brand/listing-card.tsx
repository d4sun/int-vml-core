import Link from "next/link"
import Image from "next/image"
import { Heart, ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { ListingCard as ListingCardType } from "@/lib/mock-data"

/** The standard discovery card used in the 3-up category grid. */
export function ListingCard({ listing }: { listing: ListingCardType }) {
  return (
    <article className="group overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md">
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <Image
          src={listing.image}
          alt={listing.title}
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <button
          aria-label="Save"
          className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-white/90 text-vml-ink shadow-sm backdrop-blur transition-colors hover:text-vml-red"
        >
          <Heart className="size-4" />
        </button>
      </div>
      <div className="p-4">
        <Badge variant="eyebrow">{listing.eyebrow}</Badge>
        <h3 className="mt-1 text-base font-bold text-vml-ink">
          <Link href={`/listing/${listing.slug}`} className="hover:text-vml-red">
            {listing.title}
          </Link>
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{listing.meta}</p>
        <div className="mt-3 flex items-center justify-between">
          <Badge variant="green">{listing.tag}</Badge>
          <Link
            href={`/listing/${listing.slug}`}
            className="flex items-center gap-1 text-sm font-medium text-vml-green hover:underline"
          >
            View area <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </article>
  )
}
