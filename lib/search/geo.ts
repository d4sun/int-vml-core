/** Mean Earth radius, kilometres (the haversine formula's sphere). */
export const EARTH_RADIUS_KM = 6371

export type LatLng = { lat: number; lng: number }

const toRad = (degrees: number) => (degrees * Math.PI) / 180

/**
 * Great-circle distance between two points, in kilometres (haversine). Used to
 * order a map viewport's results from its centre, and to test the SQL form in
 * `service.ts` against a known answer.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The centre of a viewport, the point results are ordered from. */
export function boxCentre(box: {
  south: number
  north: number
  west: number
  east: number
}): LatLng {
  return { lat: (box.south + box.north) / 2, lng: (box.west + box.east) / 2 }
}
