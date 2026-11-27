import Link from "next/link"
import Image from "next/image"
import { ArrowRight } from "lucide-react"
import { formatFromPrice, type ListingCardData } from "@/lib/listings/card"

/**
 * A horizontal rail of real listings. It renders nothing when there are none,
 * so a page never shows placeholder cards.
 */
export function NearbyRail({
  title = "More experiences nearby",
  subtitle,
  items = [],
}: {
  title?: string
  subtitle?: string
  items?: ListingCardData[]
}) {
  if (items.length === 0) return null

  return (
    <section className="mx-auto max-w-[1410px] px-4 py-12 sm:px-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-bold text-vml-ink">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <Link
          href="/explore"
          className="flex items-center gap-1 text-sm font-medium text-vml-navy hover:underline"
        >
          View all <ArrowRight className="size-4" />
        </Link>
      </div>

      <div className="mt-5 no-scrollbar flex gap-4 overflow-x-auto pb-2">
        {items.map((item) => (
          <article
            key={item.id}
            className="w-48 shrink-0 overflow-hidden rounded-xl border border-border bg-card"
          >
            <div className="relative h-28 w-full bg-muted">
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt={item.title}
                  fill
                  sizes="192px"
                  className="object-cover"
                />
              ) : null}
            </div>
            <div className="p-3">
              <h3 className="truncate text-sm font-semibold text-vml-ink">
                <Link
                  href={`/listings/${item.slug}`}
                  className="hover:text-vml-red"
                >
                  {item.title}
                </Link>
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatFromPrice(item.fromPrice)}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
