import Image from "next/image"
import Link from "next/link"
import {
  Search,
  Compass,
  Landmark,
  Ticket,
  UtensilsCrossed,
  Beer,
  ShoppingBag,
  Crown,
  Palette,
  BedDouble,
  Bus,
  CalendarDays,
  ArrowRight,
  ChevronRight,
} from "lucide-react"
import { VideoBand } from "@/components/brand/video-band"
import { NewsletterCta } from "@/components/brand/newsletter-cta"

const img = (topic: string, i = 1) =>
  `https://images.unsplash.com/${topic}?auto=format&fit=crop&w=900&q=70&ixid=h${i}`

const HERO_TILES = [
  { label: "Explore London", icon: Compass, href: "/explore" },
  { label: "Attractions", icon: Landmark, href: "/attractions" },
  { label: "Tours & Experiences", icon: Ticket, href: "/tours" },
  { label: "Food & Drink", icon: UtensilsCrossed, href: "/food-drink" },
  { label: "Pubs, Bars & Nightlife", icon: Beer, href: "/nightlife" },
  { label: "Shopping", icon: ShoppingBag, href: "/shopping" },
  { label: "Royal London", icon: Crown, href: "/royal-london" },
  { label: "Arts & Culture", icon: Palette, href: "/arts-culture" },
  { label: "Stay", icon: BedDouble, href: "/stay" },
  { label: "Transport & Travel", icon: Bus, href: "/transport" },
  { label: "Book & Buy", icon: CalendarDays, href: "/book" },
  { label: "Events & Festivals", icon: CalendarDays, href: "/events" },
]

const TOP_ATTRACTIONS = [
  { title: "Tower Bridge", kicker: "See the city your way", image: img("photo-1529655683826-aba9b3e77383") },
  { title: "Buckingham Palace", kicker: "West End theatre", image: img("photo-1529655683826-aba9b3e77383", 2) },
  { title: "Hyde Park", kicker: "Royal London", image: img("photo-1588714477688-cf28a50e94f7") },
  { title: "The London Pass", kicker: "80+ attractions", image: img("photo-1513635269975-59663e0ac1ad") },
]

const AREAS = [
  { title: "Central London", image: img("photo-1513635269975-59663e0ac1ad", 3) },
  { title: "East London", image: img("photo-1499781350541-7783f6c6a0c8", 3) },
  { title: "West London", image: img("photo-1543832923-44667a44c804", 3) },
  { title: "South London", image: img("photo-1520986606214-8b456906c813", 3) },
  { title: "North London", image: img("photo-1534351590666-13e3e96b5017") },
  { title: "City of London", image: img("photo-1486299267070-83823f5448dd", 3) },
]

const MUSICALS = [
  { title: "The Devil Wears Prada", price: "£38.00", image: img("photo-1503095396549-807759245b35", 4) },
  { title: "Wicked the Musical", price: "£24.25", image: img("photo-1507924538820-ede0a04b5b29") },
  { title: "Sinatra The Musical", price: "£36.75", image: img("photo-1470229722913-7c0e2dbbafd3", 4) },
  { title: "Les Misérables", price: "£29.00", image: img("photo-1516450360452-9312f5e86fc7") },
  { title: "Hamilton The Musical", price: "£45.00", image: img("photo-1503095396549-807759245b35", 5) },
  { title: "Mamma Mia!", price: "£78.75", image: img("photo-1484876065684-b683cf17d276") },
]

export default function HomePage() {
  return (
    <>
      {/* Hero — 800px tall, photo with brand (blue→red) wash + dark fade */}
      <section className="relative isolate flex h-[800px] flex-col overflow-hidden bg-[#0A0A0A]">
        <Image src={img("photo-1513635269975-59663e0ac1ad", 9)} alt="" fill priority sizes="100vw" className="object-cover" />
        {/* Brand wash: deep navy on the left, crimson on the right (Union-flag tint) */}
        <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(1,33,115,0.72)_0%,rgba(1,33,115,0.30)_32%,rgba(8,8,8,0)_58%,rgba(229,30,63,0.30)_82%,rgba(229,30,63,0.62)_100%)]" />
        {/* Readability fade so text/tiles stay legible over the centre */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,8,8,0.35)_0%,rgba(8,8,8,0.10)_38%,rgba(8,8,8,0.55)_100%)]" />

        <div className="relative mx-auto flex w-full max-w-[1410px] flex-1 flex-col px-4 py-16 sm:px-6">
          {/* Title + search — centred in the upper half */}
          <div className="flex flex-col items-center gap-8 pt-10 text-center">
            <h1 className="font-heading text-5xl font-black tracking-tight text-white uppercase drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)] sm:text-7xl lg:text-[92px] lg:leading-[0.93]">
              Discover <span className="text-[#E51E3F]">London</span>
            </h1>

            {/* Search pill with a blue→red gradient ring */}
            <div className="w-full max-w-[656px] rounded-full bg-[linear-gradient(90deg,#012173_0%,#E51E3F_100%)] p-[2px] shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
              <form className="flex items-center gap-2 rounded-full bg-white p-1.5 pl-4">
                <Search className="size-5 shrink-0 text-muted-foreground" />
                <input
                  placeholder="Ask MYLO, Your AI for London…"
                  className="h-9 flex-1 bg-transparent text-sm text-vml-ink placeholder:text-muted-foreground outline-none"
                />
                <button className="h-10 shrink-0 rounded-full bg-vml-navy-deep px-7 text-sm font-semibold text-white transition-colors hover:bg-vml-navy">
                  Search
                </button>
              </form>
            </div>
          </div>

          {/* 12 glass category tiles — 4 columns, anchored near the bottom */}
          <div className="mt-auto grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {HERO_TILES.map((t) => (
              <Link
                key={t.label}
                href={t.href}
                className="flex h-[88px] items-center gap-[18px] rounded-xl border border-white/10 bg-[rgba(212,212,212,0.18)] px-[18px] backdrop-blur-[17.5px] transition-colors hover:bg-[rgba(212,212,212,0.28)]"
              >
                <t.icon className="size-9 shrink-0 text-white" strokeWidth={1.5} />
                <span className="font-heading text-[18px] leading-[19px] font-black text-white uppercase drop-shadow-[0_1px_4px_rgba(0,0,0,0.15)]">
                  {t.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Top attractions */}
      <section className="mx-auto max-w-[1410px] px-4 py-20 sm:px-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="flex items-center gap-2 font-heading text-[11px] font-bold tracking-[2.2px] text-vml-red uppercase">
              <span className="inline-block h-0.5 w-4 rounded-full bg-vml-red" /> Don&apos;t miss out
            </p>
            <h2 className="mt-2 font-heading text-[45px] leading-[50px] font-bold text-vml-navy capitalize">
              London top attractions
            </h2>
            <p className="mt-3 max-w-[600px] text-sm leading-[23px] text-[#888888]">
              A trip to London wouldn&apos;t be complete without experiencing its most iconic attractions. Book
              in advance so you don&apos;t miss out.
            </p>
          </div>
          <Link href="/attractions" className="hidden items-center gap-1.5 text-[13px] font-bold text-vml-red hover:underline sm:flex">
            View all <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-[17px] lg:grid-cols-4">
          {TOP_ATTRACTIONS.map((a) => (
            <Link key={a.title} href="/attractions" className="group relative h-[421px] overflow-hidden rounded-2xl">
              <Image src={a.image} alt={a.title} fill sizes="(max-width:1024px) 50vw, 25vw" className="object-cover transition-transform duration-300 group-hover:scale-105" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_30%,rgba(0,0,0,0.78)_100%)]" />
              <div className="absolute bottom-0 left-0 w-full p-4">
                <p className="text-[11px] text-white/55">{a.kicker}</p>
                <h3 className="mt-1 font-heading text-[19px] leading-6 font-black text-white">{a.title}</h3>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Royal London band */}
      <section className="relative isolate overflow-hidden bg-vml-navy">
        <Image src={img("photo-1529655683826-aba9b3e77383", 7)} alt="" fill sizes="100vw" className="object-cover opacity-30" />
        <div className="relative mx-auto max-w-[1410px] px-4 py-20 sm:px-6">
          <p className="flex items-center gap-2 font-heading text-[11px] font-bold tracking-[2.2px] text-vml-red uppercase">
            <span className="inline-block h-0.5 w-4 rounded-full bg-vml-red" /> Royal London
          </p>
          <h2 className="mt-2 max-w-lg font-heading text-[45px] leading-[50px] font-bold text-white">Discover the Majesty of Royal London</h2>
          <p className="mt-3 max-w-xl text-sm text-white/75">
            From Buckingham Palace to Windsor Castle, Hampton Court to Kensington Palace — explore the palaces,
            pomp, ceremonies and traditions that define Britain&apos;s royal heritage.
          </p>
          <div className="mt-6 flex gap-3">
            <Link href="/royal-london" className="rounded-full bg-vml-red px-5 py-2.5 text-sm font-medium text-white hover:bg-vml-red/90">
              Explore Royal London
            </Link>
            <Link href="/royal-london" className="rounded-full border border-white/30 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/10">
              Changing of the Guard
            </Link>
          </div>
        </div>
      </section>

      {/* Handpicked areas */}
      <section className="mx-auto max-w-[1410px] px-4 py-20 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="max-w-xl font-heading text-[45px] leading-[50px] font-bold text-vml-navy">
            Explore Handpicked London Days And Find The Perfect Trip For You
          </h2>
          <p className="max-w-sm text-sm text-[#888888]">
            From the grandeur of the West End to the creativity of East London — each neighbourhood has its own
            character.
          </p>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AREAS.map((a) => (
            <Link key={a.title} href="/explore" className="group relative aspect-[16/10] overflow-hidden rounded-xl">
              <Image src={a.image} alt={a.title} fill sizes="(max-width:1024px) 50vw, 33vw" className="object-cover transition-transform duration-300 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <h3 className="absolute bottom-3 left-3 text-lg font-semibold text-white">{a.title}</h3>
              <span className="absolute right-3 bottom-3 flex size-7 items-center justify-center rounded-full bg-white/90 text-vml-ink">
                <ChevronRight className="size-4" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <VideoBand />

      {/* London musicals */}
      <section className="mx-auto max-w-[1410px] px-4 py-20 sm:px-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-heading text-[45px] leading-[50px] font-bold text-vml-navy">London musicals</h2>
            <p className="mt-3 max-w-xl text-sm text-[#888888]">
              Book a spot at the best London musicals. From timeless shows with catchy tunes and dazzling dance
              numbers to inspiring off-West-End musicals.
            </p>
          </div>
          <Link href="/music" className="hidden items-center gap-1 text-sm font-medium text-vml-navy hover:underline sm:flex">
            View all musicals <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {MUSICALS.map((m) => (
            <Link key={m.title} href="/music" className="group">
              <div className="relative aspect-[3/4] overflow-hidden rounded-xl">
                <Image src={m.image} alt={m.title} fill sizes="(max-width:1024px) 33vw, 16vw" className="object-cover transition-transform duration-300 group-hover:scale-105" />
              </div>
              <h3 className="mt-2 truncate text-sm font-semibold text-vml-ink">{m.title}</h3>
              <p className="text-xs font-semibold text-vml-red">from {m.price}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* What's on */}
      <section className="mx-auto max-w-[1410px] px-4 pb-20 sm:px-6">
        <p className="flex items-center gap-2 font-heading text-[11px] font-bold tracking-[2.2px] text-vml-red uppercase">
          <span className="inline-block h-0.5 w-4 rounded-full bg-vml-red" /> This season
        </p>
        <h2 className="mt-2 font-heading text-[45px] leading-[50px] font-bold text-vml-navy">What&apos;s on in London</h2>
        <p className="mt-3 max-w-xl text-sm text-[#888888]">
          Plan your visit to coincide with top London events, from annual festivals to public holidays and
          sporting spectacles.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { tag: "Events", title: "Discover what's on", desc: "From outdoor concerts to art exhibitions and street festivals — London never stops." },
            { tag: "Family", title: "School holidays in London", desc: "Keep the whole family entertained with our pick of the best activities during the school holidays." },
            { tag: "Calendar", title: "London events calendar", desc: "Search for key events each month — from the Chelsea Flower Show to New Year's fireworks." },
          ].map((c) => (
            <Link key={c.title} href="/events" className="rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md">
              <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-vml-ink">{c.tag}</span>
              <h3 className="mt-3 text-base font-bold text-vml-ink">{c.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{c.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <NewsletterCta />
    </>
  )
}
