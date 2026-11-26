import { z } from "zod"

export const MAX_SLOTS_PER_RULE = 200
export const MAX_RULE_SPAN_DAYS = 730
export const MIN_DURATION_MINUTES = 5
export const MAX_DURATION_MINUTES = 24 * 60
export const MAX_CAPACITY = 1000

export const WEEKDAYS = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** A real calendar date, `YYYY-MM-DD` (so `2026-02-30` is refused). */
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number]
    const check = new Date(Date.UTC(y, m - 1, d))

    return (
      check.getUTCFullYear() === y &&
      check.getUTCMonth() === m - 1 &&
      check.getUTCDate() === d
    )
  }, "That date does not exist")

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, HH:mm")

const duration = z
  .number("Enter a number of minutes")
  .int("Use a whole number of minutes")
  .min(
    MIN_DURATION_MINUTES,
    `A slot lasts at least ${MIN_DURATION_MINUTES} minutes`
  )
  .max(MAX_DURATION_MINUTES, "A slot lasts at most 24 hours")

const capacity = z
  .number("Enter a number of places")
  .int("Use a whole number of places")
  .min(1, "A slot needs at least 1 place")
  .max(MAX_CAPACITY, `A slot has at most ${MAX_CAPACITY} places`)

const common = { startTime: time, durationMinutes: duration, capacity }

const single = z.strictObject({
  kind: z.literal("single"),
  date,
  ...common,
})

/**
 * Every listed weekday from `startDate`, stopping after `count` slots or on
 * `until` (exactly one of them). Times are London wall-clock times.
 */
const weekly = z
  .strictObject({
    kind: z.literal("weekly"),
    startDate: date,
    weekdays: z
      .array(z.enum(WEEKDAYS))
      .min(1, "Choose at least one weekday")
      .refine(
        (days) => new Set(days).size === days.length,
        "Each weekday once"
      ),
    count: z
      .number("Enter a number")
      .int("Use a whole number")
      .min(1, "At least 1 slot")
      .max(MAX_SLOTS_PER_RULE, `At most ${MAX_SLOTS_PER_RULE} slots at a time`)
      .optional(),
    until: date.optional(),
    ...common,
  })
  .superRefine((rule, ctx) => {
    if ((rule.count === undefined) === (rule.until === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["count"],
        message: "Give either how many slots or an end date, not both",
      })
    }

    if (rule.until !== undefined) {
      const start = Date.parse(`${rule.startDate}T00:00:00Z`)
      const end = Date.parse(`${rule.until}T00:00:00Z`)

      if (end < start) {
        ctx.addIssue({
          code: "custom",
          path: ["until"],
          message: "The end date is before the start date",
        })
      } else if ((end - start) / 86_400_000 > MAX_RULE_SPAN_DAYS) {
        ctx.addIssue({
          code: "custom",
          path: ["until"],
          message: "Choose an end date within two years",
        })
      }
    }
  })

export const slotRuleSchema = z.discriminatedUnion("kind", [single, weekly])

export type SlotRule = z.infer<typeof slotRuleSchema>
