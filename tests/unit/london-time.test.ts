import { describe, expect, it } from "vitest"
import {
  londonLocalToUtc,
  londonOffsetMinutes,
  londonParts,
} from "@/lib/time/london"

const at = (iso: string) => new Date(iso)
const local = (y: number, mo: number, d: number, h: number, mi = 0) =>
  londonLocalToUtc({
    year: y,
    month: mo,
    day: d,
    hour: h,
    minute: mi,
  }).toISOString()

describe("londonOffsetMinutes", () => {
  it("is 0 in winter (GMT) and 60 in summer (BST)", () => {
    expect(londonOffsetMinutes(at("2026-01-15T12:00:00Z"))).toBe(0)
    expect(londonOffsetMinutes(at("2026-07-15T12:00:00Z"))).toBe(60)
  })

  it("changes at the real instants: 01:00Z on the last Sundays of March and October", () => {
    expect(londonOffsetMinutes(at("2026-03-29T00:59:00Z"))).toBe(0)
    expect(londonOffsetMinutes(at("2026-03-29T01:00:00Z"))).toBe(60)
    expect(londonOffsetMinutes(at("2026-10-25T00:59:00Z"))).toBe(60)
    expect(londonOffsetMinutes(at("2026-10-25T01:00:00Z"))).toBe(0)
  })

  it("ignores seconds", () => {
    expect(londonOffsetMinutes(at("2026-03-29T00:59:59.999Z"))).toBe(0)
  })
})

describe("londonParts", () => {
  it("shows London's clock, including across midnight", () => {
    expect(londonParts(at("2026-07-01T23:30:00Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 2,
      hour: 0,
      minute: 30,
    })
    expect(londonParts(at("2026-01-01T00:00:00Z"))).toEqual({
      year: 2026,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
    })
  })
})

describe("londonLocalToUtc", () => {
  it("winter wall time is the same UTC time; summer is an hour earlier", () => {
    expect(local(2026, 1, 15, 10)).toBe("2026-01-15T10:00:00.000Z")
    expect(local(2026, 7, 1, 10)).toBe("2026-07-01T09:00:00.000Z")
  })

  it("midnight and the last minute of the day, both seasons", () => {
    expect(local(2026, 7, 1, 0, 0)).toBe("2026-06-30T23:00:00.000Z")
    expect(local(2026, 7, 1, 23, 59)).toBe("2026-07-01T22:59:00.000Z")
    expect(local(2026, 12, 1, 0, 0)).toBe("2026-12-01T00:00:00.000Z")
  })

  it("the day the clocks go forward (2026-03-29): before, after, and the missing hour", () => {
    expect(local(2026, 3, 29, 0, 30)).toBe("2026-03-29T00:30:00.000Z") // GMT
    expect(local(2026, 3, 29, 2, 0)).toBe("2026-03-29T01:00:00.000Z") // BST begins
    expect(local(2026, 3, 29, 10, 0)).toBe("2026-03-29T09:00:00.000Z")
    // 01:30 does not exist: it is read as 02:30 BST, the clock having moved on.
    expect(local(2026, 3, 29, 1, 30)).toBe("2026-03-29T01:30:00.000Z")
    expect(londonParts(new Date(local(2026, 3, 29, 1, 30)))).toMatchObject({
      hour: 2,
      minute: 30,
    })
  })

  it("the day the clocks go back (2026-10-25): an ambiguous time takes its first occurrence", () => {
    expect(local(2026, 10, 25, 0, 30)).toBe("2026-10-24T23:30:00.000Z") // BST
    // 01:30 happens twice (00:30Z in BST, 01:30Z in GMT): the earlier one.
    expect(local(2026, 10, 25, 1, 30)).toBe("2026-10-25T00:30:00.000Z")
    expect(local(2026, 10, 25, 2, 0)).toBe("2026-10-25T02:00:00.000Z")
    expect(local(2026, 10, 25, 10, 0)).toBe("2026-10-25T10:00:00.000Z")
  })

  it("every existing wall time over three years round-trips exactly", () => {
    let checked = 0

    for (let day = 0; day < 365 * 3; day += 1) {
      const base = new Date(Date.UTC(2026, 0, 1 + day))

      for (const [hour, minute] of [
        [0, 0],
        [1, 30],
        [2, 0],
        [3, 15],
        [10, 0],
        [23, 45],
      ] as const) {
        const wanted = {
          year: base.getUTCFullYear(),
          month: base.getUTCMonth() + 1,
          day: base.getUTCDate(),
          hour,
          minute,
        }
        const shown = londonParts(londonLocalToUtc(wanted))
        const gap =
          // The only wall times that cannot round-trip are the spring gap.
          wanted.hour === 1 && wanted.minute === 30 && shown.hour === 2

        if (!gap) expect(shown, JSON.stringify(wanted)).toEqual(wanted)
        checked += 1
      }
    }

    expect(checked).toBe(365 * 3 * 6)
  })

  it("never returns the later duplicate in autumn, for any day of the year", () => {
    for (let day = 0; day < 365; day += 1) {
      const base = new Date(Date.UTC(2027, 0, 1 + day))
      const result = londonLocalToUtc({
        year: base.getUTCFullYear(),
        month: base.getUTCMonth() + 1,
        day: base.getUTCDate(),
        hour: 1,
        minute: 30,
      })
      const earlier = new Date(result.getTime() - 3_600_000)
      const sameWall = (a: Date, b: Date) =>
        JSON.stringify(londonParts(a)) === JSON.stringify(londonParts(b))

      // If an hour earlier shows the same wall time, `result` was the later one.
      expect(sameWall(result, earlier)).toBe(false)
    }
  })
})
