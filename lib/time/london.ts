/**
 * Europe/London wall-clock time, for slots that are set in London time but
 * stored in UTC (CR-6). Pure: it uses `Intl` for the zone rules, so it follows
 * the real BST/GMT changes with no table to keep up to date.
 */
export const LONDON = "Europe/London"

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

export type LocalParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/** The wall-clock fields London shows at this instant. */
export function londonParts(at: Date): LocalParts {
  const fields: Record<string, number> = {}

  for (const part of formatter.formatToParts(at)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value)
  }

  return {
    year: fields.year!,
    month: fields.month!,
    day: fields.day!,
    hour: fields.hour!,
    minute: fields.minute!,
  }
}

/** Minutes London is ahead of UTC at this instant: 60 in BST, 0 in GMT. */
export function londonOffsetMinutes(at: Date): number {
  const p = londonParts(at)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  // Compare at minute resolution, so seconds and milliseconds do not matter.
  const instant = Math.floor(at.getTime() / 60_000) * 60_000

  return (asUtc - instant) / 60_000
}

/**
 * The instant at which London's clock shows this wall time.
 *
 * Two days a year the wall time is not one-to-one with an instant, and the
 * rule is fixed here so slots never move by surprise:
 *
 * - **Autumn, the clock goes back (01:00 to 02:00 happens twice):** the
 *   **first** occurrence, the BST one.
 * - **Spring, the clock goes forward (01:00 to 02:00 does not exist):** the
 *   time is read as if the clock had already moved, so 01:30 becomes 02:30 BST.
 */
export function londonLocalToUtc(local: LocalParts): Date {
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute
  )

  // BST first so an ambiguous time takes its earlier instant.
  for (const offset of [60, 0]) {
    const candidate = new Date(asUtc - offset * 60_000)

    if (londonOffsetMinutes(candidate) === offset) return candidate
  }

  // Nonexistent (spring gap): the GMT reading is the shifted-forward time.
  return new Date(asUtc)
}

/**
 * The UTC instants that bound one London calendar day: `from` is local
 * midnight that starts it, `to` the midnight that ends it (exclusive). Used to
 * find slots that fall on a London date, across BST and GMT changes.
 */
export function londonDayBounds(day: {
  year: number
  month: number
  day: number
}): {
  from: Date
  to: Date
} {
  const next = new Date(Date.UTC(day.year, day.month - 1, day.day + 1))

  return {
    from: londonLocalToUtc({ ...day, hour: 0, minute: 0 }),
    to: londonLocalToUtc({
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: 0,
      minute: 0,
    }),
  }
}
