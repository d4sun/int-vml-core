import Image from "next/image"
import Link from "next/link"
import { Search } from "lucide-react"

/** The hero band on category/listing index pages: background photo, breadcrumb,
 *  title, subtitle, and an inline "Ask MYLO" search. */
export function PageHero({
  title,
  subtitle,
  breadcrumb,
  image,
}: {
  title: string
  subtitle: string
  breadcrumb: string[]
  image: string
}) {
  return (
    <section className="relative isolate overflow-hidden">
      <Image src={image} alt="" fill priority sizes="100vw" className="object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/45 to-black/20" />
      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <nav className="flex items-center gap-1.5 text-xs text-white/80">
          {breadcrumb.map((crumb, i) => (
            <span key={crumb} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-white/50">/</span>}
              <Link href="#" className="hover:text-white">
                {crumb}
              </Link>
            </span>
          ))}
        </nav>
        <h1 className="mt-3 text-3xl font-bold text-white sm:text-4xl">{title}</h1>
        <p className="mt-2 max-w-xl text-sm text-white/85">{subtitle}</p>

        <form className="mt-5 flex max-w-md items-center gap-2 rounded-full bg-white p-1.5 shadow-lg">
          <Search className="ml-2 size-4 text-muted-foreground" />
          <input
            placeholder="Ask MYLO, Your AI for London…"
            className="h-8 flex-1 bg-transparent text-sm text-vml-ink placeholder:text-muted-foreground outline-none"
          />
          <button className="h-8 rounded-full bg-vml-navy px-5 text-sm font-medium text-white hover:bg-vml-navy/90">
            Search
          </button>
        </form>
      </div>
    </section>
  )
}
