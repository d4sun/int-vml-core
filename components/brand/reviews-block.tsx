import { Star } from "lucide-react"

type Review = { name: string; location: string; date: string; rating: number; body: string; initial: string; color: string }

const REVIEWS: Review[] = [
  { name: "Priya", location: "London, UK", date: "August 2026", rating: 5, initial: "P", color: "bg-vml-navy", body: "Absolutely magnificent! The Tower of London is unlike anything else. We spent nearly four hours there and still felt like we hadn't seen everything. The Yeoman Warder tour was hilarious and incredibly informative — don't skip it." },
  { name: "Marcus", location: "New York, USA", date: "July 2026", rating: 4, initial: "M", color: "bg-vml-red", body: "Stunning historical site. The Crown Jewels are breathtaking — photos really don't do them justice. Booking tickets online saved us a lot of time. Plan at least 3–4 hours. Only minor gripe: it gets very crowded in summer." },
  { name: "Yuki", location: "Tokyo, Japan", date: "June 2026", rating: 5, initial: "Y", color: "bg-vml-green", body: "One of the best things I've ever visited. Walking through 1,000 years of history is surreal. The ravens were so charming! The audio guide is excellent. Highly recommend arriving early." },
  { name: "Sophie", location: "Paris, France", date: "May 2026", rating: 4, initial: "S", color: "bg-purple-600", body: "Incredible place with so much to explore. The White Tower is a must. I'd suggest joining the Yeoman Warder tour first thing. The café inside has decent food which is great since you'll want to stay all day." },
]

const DISTRIBUTION = [
  { stars: 5, pct: 78 },
  { stars: 4, pct: 15 },
  { stars: 3, pct: 5 },
  { stars: 2, pct: 1 },
  { stars: 1, pct: 1 },
]

export function ReviewsBlock() {
  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-vml-ink">Visitor reviews</h2>
        <div className="flex items-center gap-1.5 text-sm">
          <Stars rating={5} />
          <span className="font-bold text-vml-ink">4.8</span>
          <span className="text-muted-foreground">· 2,847 reviews</span>
        </div>
      </div>

      {/* distribution */}
      <div className="mt-4 space-y-1.5">
        {DISTRIBUTION.map((d) => (
          <div key={d.stars} className="flex items-center gap-2 text-xs">
            <span className="w-3 text-vml-ink">{d.stars}</span>
            <Star className="size-3 fill-amber-400 text-amber-400" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-vml-red" style={{ width: `${d.pct}%` }} />
            </div>
            <span className="w-8 text-right text-muted-foreground">{d.pct}%</span>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 items-stretch gap-5 sm:grid-cols-2">
        {REVIEWS.map((r) => (
          <article key={r.name} className="flex h-full flex-col rounded-xl border border-border p-4">
            <div className="flex items-center gap-3">
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${r.color}`}>
                {r.initial}
              </span>
              <div>
                <p className="text-sm font-semibold text-vml-ink">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.location} · {r.date}</p>
              </div>
            </div>
            <Stars rating={r.rating} className="mt-2.5" />
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{r.body}</p>
          </article>
        ))}
      </div>

      <button className="mt-6 block text-sm font-medium text-vml-red hover:underline">
        Show all 2,847 reviews →
      </button>
    </section>
  )
}

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={className}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`inline size-3.5 ${i < rating ? "fill-amber-400 text-amber-400" : "fill-muted text-muted"}`}
        />
      ))}
    </span>
  )
}
