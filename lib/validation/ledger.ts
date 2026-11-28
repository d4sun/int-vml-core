import { z } from "zod"

export const LEDGER_KINDS = ["all", "payment", "transfer", "refund"] as const

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

/**
 * The ledger's filters (E10-S2-01). Dates are London calendar days and both
 * are inclusive; leave both out to see everything. Strict: nothing else.
 */
export const ledgerFilterSchema = z
  .strictObject({
    kind: z.enum(LEDGER_KINDS).default("all"),
    from: londonDate.optional(),
    to: londonDate.optional(),
  })
  .refine((f) => (f.from === undefined) === (f.to === undefined), {
    message: "Give both dates, or neither",
    path: ["from"],
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, {
    message: "The end date is before the start date",
    path: ["to"],
  })

export type LedgerFilter = z.infer<typeof ledgerFilterSchema>
