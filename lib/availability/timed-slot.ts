import { toNormalizedError } from "@/lib/actions/result"
import { londonLocalToUtc } from "@/lib/time/london"
import {
  MAX_SLOTS_PER_RULE,
  WEEKDAYS,
  slotRuleSchema,
  type SlotRule,
} from "@/lib/validation/slot-rule"
import { ValidationError } from "@/lib/errors"
import type { AvailabilityModule } from "./module"

export type GeneratedSlot = {
  startAt: Date
  endAt: Date
  capacity: number
  /** A new slot has all its places left (CR-3 starts from here). */
  remaining: number
}

type Civil = { year: number; month: number; day: number }

const parseDate = (value: string): Civil => {
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ]

  return { year, month, day }
}

/** 0 = Sunday, as `Date#getUTCDay`; mapped to the rule's names. */
const weekdayName = (c: Civil) =>
  WEEKDAYS[
    (new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay() + 6) % 7
  ]!

const nextDay = (c: Civil): Civil => {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + 1))

  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

const isoDate = (c: Civil) =>
  `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`

function slotOn(day: Civil, rule: SlotRule): GeneratedSlot {
  const [hour, minute] = rule.startTime.split(":").map(Number) as [
    number,
    number,
  ]
  const startAt = londonLocalToUtc({ ...day, hour, minute })

  return {
    startAt,
    // Exact elapsed time: a 2 hour slot is 2 hours long even across a clock
    // change, so what the vendor sets is what the tourist gets.
    endAt: new Date(startAt.getTime() + rule.durationMinutes * 60_000),
    capacity: rule.capacity,
    remaining: rule.capacity,
  }
}

/**
 * Turns a rule into slots. Times are London wall-clock times converted to UTC
 * date by date, so "every Saturday at 10:00" stays 10:00 London time across
 * the BST/GMT changes (09:00Z in summer, 10:00Z in winter), never a fixed UTC
 * hour. Results are in time order, with no duplicates.
 */
export function generateTimedSlots(rule: SlotRule): GeneratedSlot[] {
  if (rule.kind === "single") {
    return [slotOn(parseDate(rule.date), rule)]
  }

  const wanted = new Set(rule.weekdays)
  const slots: GeneratedSlot[] = []
  const last = rule.until === undefined ? undefined : parseDate(rule.until)
  let day = parseDate(rule.startDate)

  while (true) {
    if (last && isoDate(day) > isoDate(last)) break
    if (rule.count !== undefined && slots.length >= rule.count) break

    if (wanted.has(weekdayName(day))) {
      slots.push(slotOn(day, rule))

      if (slots.length > MAX_SLOTS_PER_RULE) {
        throw new ValidationError("Please check the highlighted fields.", {
          until: [
            `That would create more than ${MAX_SLOTS_PER_RULE} slots at once`,
          ],
        })
      }
    }

    day = nextDay(day)
  }

  return slots
}

export const timedSlotModule: AvailabilityModule<SlotRule, GeneratedSlot> = {
  kind: "TIMED_SLOT",

  parseRule(input) {
    const parsed = slotRuleSchema.safeParse(input)

    if (!parsed.success) throw toNormalizedError(parsed.error)

    return parsed.data
  },

  generate: generateTimedSlots,
}

/** The module for a category type. Only timed slots are implemented. */
export function getAvailabilityModule(kind: string) {
  if (kind === "TIMED_SLOT") return timedSlotModule

  throw new ValidationError("This kind of availability is not supported yet")
}
