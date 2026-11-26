import type { CategoryType } from "@prisma/client"

/**
 * A kind of availability a product can have (the model's seam for timed
 * slots, date ranges, tables and passes). Only timed slots exist; the others
 * are reserved and `getAvailabilityModule` refuses them.
 */
export interface AvailabilityModule<Rule, Generated> {
  readonly kind: CategoryType
  /** Reads and validates untrusted input. Throws a `ValidationError`. */
  parseRule(input: unknown): Rule
  /** The bookable units a rule describes. Pure: no clock, no database. */
  generate(rule: Rule): Generated[]
}
