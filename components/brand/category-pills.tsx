import Link from "next/link"
import { cn } from "cn"
import { CATEGORY_PILLS } from "@/lib/mock-data"

/** The wrap-around row of category pills shown under the hero on listing pages. */
export function CategoryPills({ activeHref }: { activeHref?: string }) {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6">
      <div className="flex flex-wrap justify-center gap-2">
        {CATEGORY_PILLS.map((p) => {
          const active = p.href === activeHref
          return (
            <Link
              key={p.label}
              href={p.href}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "border-vml-navy bg-vml-navy text-white"
                  : "border-border bg-white text-vml-ink hover:border-vml-navy/40"
              )}
            >
              {p.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
