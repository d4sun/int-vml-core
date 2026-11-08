import { Star, MapPin, Clock, Share2, Heart, Check, Lightbulb } from "lucide-react"
import { DetailGallery } from "@/components/brand/detail-gallery"
import { BookingWidget } from "@/components/brand/booking-widget"
import { AccordionList } from "@/components/brand/accordion-list"
import { ReviewsBlock } from "@/components/brand/reviews-block"
import { VenueMapSection } from "@/components/brand/venue-map-section"
import { NearbyRail } from "@/components/brand/nearby-rail"
import { NewsletterCta } from "@/components/brand/newsletter-cta"

const img = (topic: string, i = 1) =>
  `https://images.unsplash.com/${topic}?auto=format&fit=crop&w=1000&q=72&ixid=d${i}`

const GALLERY = [
  img("photo-1529655683826-aba9b3e77383"),
  img("photo-1486299267070-83823f5448dd", 2),
  img("photo-1543832923-44667a44c804", 3),
  img("photo-1520986606214-8b456906c813", 4),
  img("photo-1513635269975-59663e0ac1ad", 5),
]

const HIGHLIGHTS = [
  "1,000 years of history",
  "Crown Jewels included",
  "Yeoman Warder tour",
  "Mobile tickets accepted",
  "2 min from Tower Hill tube",
]

const INCLUDED = [
  "Crown Jewels exhibition",
  "The White Tower & armouries",
  "Yeoman Warder guided tour",
  "Medieval palace & battlements",
  "Line of Kings armour display",
  "Tower ravens & outer ward",
  "Skip-the-queue entry",
  "Re-entry on same day",
]

const GOOD_TO_KNOW = [
  "Tickets are date and time-specific — choose your slot carefully",
  "Bags are subject to security screening on entry",
  "Photography is allowed throughout, including the Crown Jewels",
  "Wheelchair-accessible route available — contact the venue in advance",
  "Audio guides available in 10 languages (extra charge)",
]

const GUIDE = [
  { q: "What is the Tower of London?", a: "A historic castle and UNESCO World Heritage Site on the north bank of the River Thames, founded by William the Conqueror in 1066." },
  { q: "What can I see there?", a: "The Crown Jewels, the White Tower, the medieval palace, the Line of Kings armour display, the famous ravens, and a Yeoman Warder guided tour." },
  { q: "How long does a visit take?", a: "Most visitors spend 3–4 hours. Arrive early to beat the crowds, especially in summer." },
  { q: "Do I need to pre-book tickets?", a: "Yes — tickets are date and time-specific and booking online lets you skip the queue." },
  { q: "Where is it and how do I get there?", a: "Tower Hill, EC3N 4AB. Two minutes' walk from Tower Hill underground station." },
  { q: "What are the opening times?", a: "Tuesday to Saturday, 9:00am – 5:30pm (last entry 5:00pm)." },
]

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  await params // slug is available for a real data lookup later; mock content for now.

  return (
    <>
      <div className="mx-auto max-w-[1410px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-widest text-vml-red uppercase">Historic Fortress</p>
            <h1 className="mt-1 text-3xl font-bold text-vml-ink">Tower of London</h1>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1 font-semibold text-vml-ink">
                <Star className="size-4 fill-amber-400 text-amber-400" /> 4.8
                <span className="font-normal text-muted-foreground">(41,250 reviews)</span>
              </span>
              <span className="flex items-center gap-1"><MapPin className="size-4" /> Tower Hill, EC3N 4AB</span>
              <span className="flex items-center gap-1 text-vml-navy"><Clock className="size-4" /> Tue–Sat: 9:00am – 5:30pm (last entry 5:00pm)</span>
            </div>
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

        {/* Two-column body */}
        <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0">
            {/* highlight pills */}
            <div className="flex flex-wrap gap-2">
              {HIGHLIGHTS.map((h) => (
                <span key={h} className="rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-vml-ink">
                  {h}
                </span>
              ))}
            </div>

            <section className="mt-6">
              <h2 className="text-lg font-bold text-vml-ink">About this experience</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                For over 1,000 years, HM Tower of London has guarded the city. Founded by William the Conqueror
                in 1066, this UNESCO World Heritage Site has served as a royal palace, state prison, treasury,
                armoury, and home to exotic animals. Today it houses the legendary Crown Jewels — one of the most
                visited collections in the world.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Your ticket includes access to the White Tower, the Jewel House, the medieval palace, the
                boardwalk, and a Yeoman Warder tour — led by one of the Tower&apos;s own resident guards whose
                colourful stories of royal intrigue, dark dungeons, and famous executions bring history vividly
                to life.
              </p>
            </section>

            <section className="mt-8">
              <h2 className="text-lg font-bold text-vml-ink">What&apos;s included</h2>
              <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {INCLUDED.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-vml-ink">
                    <Check className="mt-0.5 size-4 shrink-0 text-vml-green" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-6 rounded-xl bg-amber-50 p-4">
              <h3 className="flex items-center gap-2 text-sm font-bold text-vml-ink">
                <Lightbulb className="size-4 text-amber-500" /> Good to know
              </h3>
              <ul className="mt-2 space-y-1.5">
                {GOOD_TO_KNOW.map((g) => (
                  <li key={g} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="text-amber-500">·</span> {g}
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-8">
              <h2 className="text-lg font-bold text-vml-ink">Visitor guide</h2>
              <div className="mt-3">
                <AccordionList items={GUIDE} />
              </div>
            </section>

            <div className="mt-10 border-t border-border pt-10">
              <ReviewsBlock />
            </div>

            <div className="mt-10 border-t border-border pt-10">
              <VenueMapSection lat={51.5081} lng={-0.0759} label="Tower Hill, London EC3N 4AB · United Kingdom" />
            </div>
          </div>

          {/* Sticky booking rail */}
          <div className="lg:min-w-0">
            <BookingWidget />
          </div>
        </div>
      </div>

      <NearbyRail />
      <NewsletterCta />
    </>
  )
}
