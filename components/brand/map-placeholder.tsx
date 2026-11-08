import { Search, Maximize2, Plus, Minus, Home, ExternalLink } from "lucide-react"

/** Static stand-in for the Google Maps embed on detail pages. Pure UI — no live map. */
export function MapPlaceholder({ locationLabel }: { locationLabel: string }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-vml-ink">Where you&apos;ll be</h2>
      <p className="mt-1 text-sm text-muted-foreground">{locationLabel}</p>

      <div className="relative mt-4 h-80 overflow-hidden rounded-xl border border-border bg-[#e8e8e8]">
        {/* faux map search */}
        <div className="absolute top-3 left-3 flex h-9 w-56 items-center gap-2 rounded-full bg-white px-3 shadow">
          <Search className="size-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Explore dining</span>
        </div>
        {/* zoom controls */}
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          <MapBtn><Maximize2 className="size-4" /></MapBtn>
        </div>
        <div className="absolute top-16 right-3 flex flex-col overflow-hidden rounded-full bg-white shadow">
          <MapBtn flat><Plus className="size-4" /></MapBtn>
          <MapBtn flat><Minus className="size-4" /></MapBtn>
        </div>
        {/* center pin */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-black text-white shadow-lg">
            <Home className="size-5" />
          </span>
        </div>
        {/* open in maps */}
        <a href="#" className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-vml-navy shadow">
          Open in Google Maps <ExternalLink className="size-3.5" />
        </a>
        <span className="absolute right-3 bottom-3 text-[10px] text-muted-foreground">Map data ©2026</span>
      </div>
    </div>
  )
}

function MapBtn({ children, flat }: { children: React.ReactNode; flat?: boolean }) {
  return (
    <button className={`flex size-9 items-center justify-center text-vml-ink ${flat ? "" : "rounded-full bg-white shadow"}`}>
      {children}
    </button>
  )
}
