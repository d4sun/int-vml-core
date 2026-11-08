import Link from "next/link"
import Image from "next/image"
import { ArrowRight } from "lucide-react"
import { NEARBY_EXPERIENCES } from "@/lib/mock-data"

/** "More experiences nearby" horizontal rail of bookable cards. */
export function NearbyRail({
  title = "More experiences nearby",
  subtitle = "Visitors to the Tower of London also enjoyed…",
}: {
  title?: string
  subtitle?: string
}) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-bold text-vml-ink">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Link href="#" className="flex items-center gap-1 text-sm font-medium text-vml-navy hover:underline">
          View all <ArrowRight className="size-4" />
        </Link>
      </div>

      <div className="no-scrollbar mt-5 flex gap-4 overflow-x-auto pb-2">
        {NEARBY_EXPERIENCES.map((e) => (
          <article
            key={e.id}
            className="w-48 shrink-0 overflow-hidden rounded-xl border border-border bg-card"
          >
            <div className="relative h-28 w-full">
              <Image src={e.image} alt={e.title} fill sizes="192px" className="object-cover" />
              <span className="absolute top-2 left-2 rounded bg-vml-red px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                {e.tag}
              </span>
            </div>
            <div className="p-3">
              <h3 className="truncate text-sm font-semibold text-vml-ink">{e.title}</h3>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <span className="text-vml-red">◉</span> {e.area}
              </p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-vml-ink">{e.price}</span>
                <Link href="#" className="flex items-center gap-0.5 text-xs font-semibold text-vml-red hover:underline">
                  Book <ArrowRight className="size-3" />
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
