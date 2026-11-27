"use client"

import dynamic from "next/dynamic"
import type { LatLngBoundsExpression } from "leaflet"
import type { MapPin } from "./search-map"

// Leaflet touches `window`, so the map is loaded only in the browser.
const SearchMap = dynamic(() => import("./search-map"), {
  ssr: false,
  loading: () => (
    <div
      className="h-[420px] animate-pulse rounded-2xl bg-muted"
      aria-label="Loading map"
    />
  ),
})

export function SearchMapSection(props: {
  pins: MapPin[]
  input: Record<string, unknown>
  area?: LatLngBoundsExpression
}) {
  return <SearchMap {...props} />
}
