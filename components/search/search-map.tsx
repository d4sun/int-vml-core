"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet"
import { Icon, type LatLngBoundsExpression } from "leaflet"
import "leaflet/dist/leaflet.css"
import { Button } from "@/components/ui/button"
import { formatFromPrice } from "@/lib/listings/card"
import { searchHref } from "@/lib/search/params"

// Leaflet's default marker paths break under bundlers, so use the published CDN images.
const markerIcon = new Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

export type MapPin = {
  id: string
  slug: string
  title: string
  lat: number
  lng: number
  fromPrice: number | null
}

const LONDON: [number, number] = [51.5074, -0.1278]

/** Lets the visitor search the area the map is showing, keeping the other filters. */
function SearchThisArea({ input }: { input: Record<string, unknown> }) {
  const map = useMap()
  const router = useRouter()

  return (
    <Button
      type="button"
      variant="outline"
      className="absolute top-3 right-3 z-[1000]"
      onClick={() => {
        const b = map.getBounds()

        router.push(
          searchHref({
            ...input,
            page: undefined,
            south: b.getSouth(),
            north: b.getNorth(),
            west: b.getWest(),
            east: b.getEast(),
          })
        )
      }}
    >
      Search this area
    </Button>
  )
}

/**
 * The results on a map. Pins come from the same search as the list, so the two
 * always agree. Client-only: Leaflet needs a browser.
 */
export default function SearchMap({
  pins,
  input,
  area,
}: {
  pins: MapPin[]
  /** The current search, so "search this area" keeps its other filters. */
  input: Record<string, unknown>
  /** The viewport the search was run for, when there was one. */
  area?: LatLngBoundsExpression
}) {
  return (
    <div className="relative h-[420px] overflow-hidden rounded-2xl border border-border">
      <MapContainer
        center={LONDON}
        zoom={12}
        bounds={area}
        scrollWheelZoom={false}
        className="h-full w-full"
        aria-label="Map of places"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((pin) => (
          <Marker key={pin.id} position={[pin.lat, pin.lng]} icon={markerIcon}>
            <Popup>
              <Link href={`/listings/${pin.slug}`} className="font-semibold">
                {pin.title}
              </Link>
              <div className="text-sm">{formatFromPrice(pin.fromPrice)}</div>
            </Popup>
          </Marker>
        ))}
        <SearchThisArea input={input} />
      </MapContainer>
    </div>
  )
}
