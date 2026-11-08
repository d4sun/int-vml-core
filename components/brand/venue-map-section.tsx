"use client"

import dynamic from "next/dynamic"
import { ExternalLink } from "lucide-react"

// react-leaflet touches `window`, so it must never render on the server.
const VenueMap = dynamic(() => import("@/components/brand/venue-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
})

/** "Where you'll be" section: heading, address, and an OSM/Leaflet map
 *  anchored to the venue's coordinates (no user geolocation). */
export function VenueMapSection({
  lat,
  lng,
  label,
}: {
  lat: number
  lng: number
  label: string
}) {
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`

  return (
    <div>
      <h2 className="text-lg font-bold text-vml-ink">Where you&apos;ll be</h2>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>

      <div className="relative isolate z-0 mt-4 h-80 overflow-hidden rounded-xl border border-border">
        <VenueMap lat={lat} lng={lng} label={label} />
        <a
          href={gmaps}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-3 left-3 z-[1000] flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-medium text-vml-navy shadow"
        >
          Open in Google Maps <ExternalLink className="size-3.5" />
        </a>
      </div>
    </div>
  )
}
