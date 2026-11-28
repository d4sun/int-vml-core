import { z } from "zod"

const londonDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-28")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number]
    const date = new Date(Date.UTC(y, m - 1, d))

    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    )
  }, "That is not a real date")

/** A London date range for the metrics, inclusive. Both dates or neither. */
export const metricsRangeSchema = z
  .strictObject({ from: londonDate.optional(), to: londonDate.optional() })
  .refine((r) => (r.from === undefined) === (r.to === undefined), {
    message: "Give both dates, or neither",
    path: ["from"],
  })
  .refine((r) => !r.from || !r.to || r.from <= r.to, {
    message: "The end date is before the start date",
    path: ["to"],
  })

export type MetricsRange = z.infer<typeof metricsRangeSchema>
