import { describe, expect, it } from "vitest"
import {
  generateTimedSlots,
  getAvailabilityModule,
  timedSlotModule,
} from "@/lib/availability/timed-slot"
import { ValidationError } from "@/lib/errors"
import { londonParts } from "@/lib/time/london"
import type { SlotRule } from "@/lib/validation/slot-rule"

const base = { startTime: "10:00", durationMinutes: 120, capacity: 20 } as const
const weekly = (over: Record<string, unknown> = {}): SlotRule =>
  ({
    kind: "weekly",
    startDate: "2026-10-03",
    weekdays: ["SAT"],
    count: 8,
    ...base,
    ...over,
  }) as SlotRule

const iso = (s: { startAt: Date }[]) => s.map((x) => x.startAt.toISOString())
const wall = (d: Date) => {
  const p = londonParts(d)

  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
}

describe("TC-E5S2-01: every Saturday x8 at capacity 20", () => {
  const slots = generateTimedSlots(weekly())

  it("makes 8 slots, each with all 20 places left", () => {
    expect(slots).toHaveLength(8)
    expect(slots.every((s) => s.capacity === 20 && s.remaining === 20)).toBe(
      true
    )
  })

  it("they are the 8 Saturdays from the start date, in order", () => {
    expect(slots.map((s) => wall(s.startAt).slice(0, 10))).toEqual([
      "2026-10-03",
      "2026-10-10",
      "2026-10-17",
      "2026-10-24",
      "2026-10-31",
      "2026-11-07",
      "2026-11-14",
      "2026-11-21",
    ])
  })

  it("stays 10:00 London time across the clocks going back on 25 October", () => {
    expect(slots.every((s) => wall(s.startAt).endsWith("10:00"))).toBe(true)
    // BST (09:00Z) before the change, GMT (10:00Z) after it.
    expect(iso(slots).slice(0, 4)).toEqual([
      "2026-10-03T09:00:00.000Z",
      "2026-10-10T09:00:00.000Z",
      "2026-10-17T09:00:00.000Z",
      "2026-10-24T09:00:00.000Z",
    ])
    expect(iso(slots).slice(4)).toEqual([
      "2026-10-31T10:00:00.000Z",
      "2026-11-07T10:00:00.000Z",
      "2026-11-14T10:00:00.000Z",
      "2026-11-21T10:00:00.000Z",
    ])
  })

  it("each slot lasts exactly the duration", () => {
    for (const s of slots) {
      expect(s.endAt.getTime() - s.startAt.getTime()).toBe(120 * 60_000)
    }
  })
})

describe("DST edges", () => {
  it("clocks going forward: Sundays across 29 March 2026 stay 10:00 London", () => {
    const slots = generateTimedSlots(
      weekly({ startDate: "2026-03-22", weekdays: ["SUN"], count: 3 })
    )

    expect(iso(slots)).toEqual([
      "2026-03-22T10:00:00.000Z",
      "2026-03-29T09:00:00.000Z",
      "2026-04-05T09:00:00.000Z",
    ])
  })

  it("a slot in the spring gap is read as the shifted-forward time, once", () => {
    const [slot] = generateTimedSlots({
      kind: "single",
      date: "2026-03-29",
      ...base,
      startTime: "01:30",
    })

    expect(slot!.startAt.toISOString()).toBe("2026-03-29T01:30:00.000Z")
    expect(wall(slot!.startAt)).toBe("2026-03-29 02:30")
  })

  it("a slot in the autumn overlap is the first occurrence, once", () => {
    const [slot] = generateTimedSlots({
      kind: "single",
      date: "2026-10-25",
      ...base,
      startTime: "01:30",
    })

    expect(slot!.startAt.toISOString()).toBe("2026-10-25T00:30:00.000Z")
  })

  it("a 2 hour slot that spans the change is still exactly 2 hours long", () => {
    const [slot] = generateTimedSlots({
      kind: "single",
      date: "2026-03-29",
      ...base,
      startTime: "00:30",
      durationMinutes: 120,
    })

    expect(slot!.endAt.getTime() - slot!.startAt.getTime()).toBe(2 * 3_600_000)
    expect(wall(slot!.endAt)).toBe("2026-03-29 03:30")
  })

  it("a late-evening slot lands on the right London day in summer and winter", () => {
    const summer = generateTimedSlots({
      kind: "single",
      date: "2026-07-01",
      ...base,
      startTime: "23:30",
    })
    const winter = generateTimedSlots({
      kind: "single",
      date: "2026-12-01",
      ...base,
      startTime: "23:30",
    })

    expect(summer[0]!.startAt.toISOString()).toBe("2026-07-01T22:30:00.000Z")
    expect(winter[0]!.startAt.toISOString()).toBe("2026-12-01T23:30:00.000Z")
    expect(wall(summer[0]!.startAt)).toBe("2026-07-01 23:30")
  })

  it("a weekly rule across a whole year keeps every slot at the same London time", () => {
    const slots = generateTimedSlots(
      weekly({ startDate: "2026-01-03", count: 52 })
    )

    expect(slots).toHaveLength(52)
    expect(slots.every((s) => wall(s.startAt).endsWith("10:00"))).toBe(true)
    expect(new Set(iso(slots).map((x) => x.slice(11))).size).toBe(2) // 09:00Z and 10:00Z
  })
})

describe("weekly rules", () => {
  it("several weekdays are interleaved in date order", () => {
    const slots = generateTimedSlots(
      weekly({ startDate: "2026-06-01", weekdays: ["WED", "MON"], count: 4 })
    )

    expect(slots.map((s) => wall(s.startAt).slice(0, 10))).toEqual([
      "2026-06-01",
      "2026-06-03",
      "2026-06-08",
      "2026-06-10",
    ])
  })

  it("the start date itself counts when it is a wanted weekday, and is skipped when not", () => {
    // 2026-06-01 is a Monday.
    expect(
      wall(
        generateTimedSlots(
          weekly({ startDate: "2026-06-01", weekdays: ["MON"], count: 1 })
        )[0]!.startAt
      )
    ).toContain("2026-06-01")
    expect(
      wall(
        generateTimedSlots(
          weekly({ startDate: "2026-06-01", weekdays: ["TUE"], count: 1 })
        )[0]!.startAt
      )
    ).toContain("2026-06-02")
  })

  it("an end date includes that day and stops after it", () => {
    const slots = generateTimedSlots(
      weekly({
        startDate: "2026-06-01",
        weekdays: ["MON"],
        count: undefined,
        until: "2026-06-15",
      })
    )

    expect(slots.map((s) => wall(s.startAt).slice(0, 10))).toEqual([
      "2026-06-01",
      "2026-06-08",
      "2026-06-15",
    ])
  })

  it("an end date before any wanted weekday gives no slots", () => {
    expect(
      generateTimedSlots(
        weekly({
          startDate: "2026-06-02",
          weekdays: ["MON"],
          count: undefined,
          until: "2026-06-05",
        })
      )
    ).toEqual([])
  })

  it("crosses month and year ends", () => {
    const slots = generateTimedSlots(
      weekly({ startDate: "2026-12-28", weekdays: ["MON"], count: 3 })
    )

    expect(slots.map((s) => wall(s.startAt).slice(0, 10))).toEqual([
      "2026-12-28",
      "2027-01-04",
      "2027-01-11",
    ])
  })

  it("a leap day is a day like any other", () => {
    const slots = generateTimedSlots(
      weekly({ startDate: "2028-02-28", weekdays: ["TUE"], count: 2 })
    )

    expect(slots.map((s) => wall(s.startAt).slice(0, 10))).toEqual([
      "2028-02-29",
      "2028-03-07",
    ])
  })

  it("refuses a rule that would make more than 200 slots, however it is bounded", () => {
    const all = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

    expect(() =>
      generateTimedSlots(
        weekly({
          startDate: "2026-01-01",
          weekdays: all,
          count: undefined,
          until: "2026-12-31",
        })
      )
    ).toThrow(ValidationError)
    expect(
      generateTimedSlots(
        weekly({ startDate: "2026-01-01", weekdays: all, count: 200 })
      )
    ).toHaveLength(200)
  })
})

describe("the 200 slot limit is exact", () => {
  const all = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
  // Daily from 1 January 2026: day 200 is 19 July, day 201 is 20 July.
  const until = (end: string) =>
    weekly({
      startDate: "2026-01-01",
      weekdays: all,
      count: undefined,
      until: end,
    })

  it("exactly 200 slots is allowed and 201 is refused", () => {
    expect(generateTimedSlots(until("2026-07-19"))).toHaveLength(200)
    expect(() => generateTimedSlots(until("2026-07-20"))).toThrow(
      ValidationError
    )
  })
})

describe("properties", () => {
  it("slots are strictly increasing and never duplicated, whatever the rule", () => {
    const names = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

    for (let seed = 0; seed < 60; seed += 1) {
      const weekdays = names.filter(
        (_, i) => (seed >> (i % 6)) % 2 === 0 || i === seed % 7
      )
      const slots = generateTimedSlots(
        weekly({
          startDate: `2026-${String((seed % 12) + 1).padStart(2, "0")}-${String((seed % 27) + 1).padStart(2, "0")}`,
          weekdays,
          count: (seed % 40) + 1,
          startTime: ["00:00", "01:30", "02:30", "10:00", "23:59"][seed % 5],
        })
      )

      expect(slots).toHaveLength((seed % 40) + 1)

      for (let i = 1; i < slots.length; i += 1) {
        expect(slots[i]!.startAt.getTime(), `seed ${seed}`).toBeGreaterThan(
          slots[i - 1]!.startAt.getTime()
        )
      }

      expect(slots.every((s) => s.remaining === s.capacity)).toBe(true)
    }
  })
})

describe("the module", () => {
  it("reads and validates a rule, refusing bad input with field errors", () => {
    expect(timedSlotModule.kind).toBe("TIMED_SLOT")
    expect(
      timedSlotModule.parseRule({ kind: "single", date: "2026-06-01", ...base })
        .kind
    ).toBe("single")

    for (const bad of [
      { kind: "single", date: "2026-02-30", ...base },
      { kind: "single", date: "2026-6-1", ...base },
      { kind: "single", date: "2026-06-01", ...base, startTime: "24:00" },
      { kind: "single", date: "2026-06-01", ...base, startTime: "9:00" },
      { kind: "single", date: "2026-06-01", ...base, durationMinutes: 4 },
      { kind: "single", date: "2026-06-01", ...base, durationMinutes: 1441 },
      { kind: "single", date: "2026-06-01", ...base, durationMinutes: 60.5 },
      { kind: "single", date: "2026-06-01", ...base, capacity: 0 },
      { kind: "single", date: "2026-06-01", ...base, capacity: 1001 },
      { kind: "single", date: "2026-06-01", ...base, remaining: 5 },
      {
        kind: "weekly",
        startDate: "2026-06-01",
        weekdays: [],
        count: 3,
        ...base,
      },
      {
        kind: "weekly",
        startDate: "2026-06-01",
        weekdays: ["MON", "MON"],
        count: 3,
        ...base,
      },
      {
        kind: "weekly",
        startDate: "2026-06-01",
        weekdays: ["FUNDAY"],
        count: 3,
        ...base,
      },
      { kind: "weekly", startDate: "2026-06-01", weekdays: ["MON"], ...base },
      {
        kind: "weekly",
        startDate: "2026-06-01",
        weekdays: ["MON"],
        count: 3,
        until: "2026-07-01",
        ...base,
      },
      {
        kind: "weekly",
        startDate: "2026-06-01",
        weekdays: ["MON"],
        count: 201,
        ...base,
      },
      {
        kind: "weekly",
        startDate: "2026-06-01",
        weekdays: ["MON"],
        until: "2026-05-01",
        ...base,
      },
      {
        kind: "weekly",
        startDate: "2026-06-01",
        weekdays: ["MON"],
        until: "2028-06-02",
        ...base,
      },
      { kind: "monthly" },
    ]) {
      expect(() => timedSlotModule.parseRule(bad), JSON.stringify(bad)).toThrow(
        ValidationError
      )
    }
  })

  it("an end date exactly two years out is allowed", () => {
    expect(
      timedSlotModule.parseRule({
        kind: "weekly",
        startDate: "2026-06-01",
        weekdays: ["MON"],
        until: "2028-05-31",
        ...base,
      }).kind
    ).toBe("weekly")
  })

  it("only timed slots are supported; the reserved kinds are refused", () => {
    expect(getAvailabilityModule("TIMED_SLOT")).toBe(timedSlotModule)

    for (const kind of ["DATE_RANGE", "TABLE", "PASS", "nope"]) {
      expect(() => getAvailabilityModule(kind)).toThrow(ValidationError)
    }
  })
})
