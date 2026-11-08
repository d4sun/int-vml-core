import Link from "next/link"
import { Share2, Heart, Check } from "lucide-react"
import { DetailGallery } from "@/components/brand/detail-gallery"
import { VenueMapSection } from "@/components/brand/venue-map-section"
import { NearbyRail } from "@/components/brand/nearby-rail"
import { NewsletterCta } from "@/components/brand/newsletter-cta"
import { EventTabs } from "@/components/brand/event-tabs"

const img = (topic: string, i = 1) =>
  `https://images.unsplash.com/${topic}?auto=format&fit=crop&w=1000&q=72&ixid=e${i}`

const GALLERY = [
  img("photo-1467810563316-b5476525c0f9"),
  img("photo-1529655683826-aba9b3e77383", 2),
  img("photo-1520986606214-8b456906c813", 3),
  img("photo-1486299267070-83823f5448dd", 4),
  img("photo-1513635269975-59663e0ac1ad", 5),
]

const INCLUDED = [
  "London's largest free arts festival",
  "Outdoor theatre, music & performance art",
  "Breathtaking fireworks finale over the Thames",
  "River processions & floating installations",
  "Entirely free to attend",
]

const ALSO_THIS_MONTH = ["Open House London", "Great River Race", "London Fashion Week"]

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  await params

  return (
    <>
      <div className="mx-auto max-w-[1410px] px-4 py-8 sm:px-6">
        {/* Breadcrumb + header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <nav className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <Link href="/" className="hover:text-vml-ink">Home</Link>
              <span>›</span>
              <Link href="/events" className="hover:text-vml-ink">Event Calendar</Link>
              <span>›</span>
              <Link href="/events" className="hover:text-vml-ink">Christmas &amp; New Year</Link>
              <span>›</span>
              <span className="text-vml-red">London New Year&apos;s Eve Fireworks</span>
            </nav>
            <h1 className="mt-2 text-3xl font-bold text-vml-ink">London New Year&apos;s Eve Fireworks</h1>
          </div>
          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-vml-ink hover:bg-muted">
              <Share2 className="size-4" /> Share
            </button>
            <button className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-vml-ink hover:bg-muted">
              <Heart className="size-4" /> Save
            </button>
          </div>
        </div>

        <div className="mt-6">
          <DetailGallery images={GALLERY} />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0">
            <EventTabs />
          </div>

          {/* What's included card */}
          <aside>
            <div className="overflow-hidden rounded-2xl border border-border shadow-sm">
              <div className="bg-card p-5">
                <h3 className="text-base font-bold text-vml-ink">What&apos;s included</h3>
                <ul className="mt-3 space-y-2.5">
                  {INCLUDED.map((i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-vml-ink">
                      <Check className="mt-0.5 size-4 shrink-0 text-vml-green" /> {i}
                    </li>
                  ))}
                </ul>

                <div className="mt-5 border-t border-border pt-4">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Also this month
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {ALSO_THIS_MONTH.map((e) => (
                      <li key={e} className="flex items-center gap-2 text-sm text-vml-ink">
                        <span className="size-1.5 rounded-full bg-vml-red" /> {e}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="flex items-center justify-between bg-vml-navy px-5 py-4 text-white">
                <div>
                  <p className="text-[11px] tracking-wide text-white/70 uppercase">Category</p>
                  <p className="text-sm font-semibold">Culture Event</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-vml-navy">
                  Free to attend
                </span>
              </div>
            </div>
          </aside>
        </div>

        <div className="mt-10">
          <VenueMapSection lat={51.5055} lng={-0.0754} label="Westminster Bridge to Tower Bridge, London · United Kingdom" />
        </div>
      </div>

      <NearbyRail title="More events like this" subtitle="Visitors to the Tower of London also enjoyed…" />
      <NewsletterCta />
    </>
  )
}
