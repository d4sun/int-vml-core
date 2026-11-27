/**
 * Platform bounds and defaults for a product's cancellation and booking
 * policy (decision D4, still open: these values are a proposal, kept in one
 * place so they can change without touching anything else).
 *
 * - `cancelWindowHours`: a tourist may cancel for a refund only if the slot is
 *   at least this many hours away.
 * - `bookingCutoffHours`: bookings close this many hours before the slot.
 */
export const POLICY_BOUNDS = {
  cancelWindowHours: { min: 0, max: 720 },
  bookingCutoffHours: { min: 0, max: 168 },
} as const

export const DEFAULT_POLICY = {
  cancelWindowHours: 24,
  bookingCutoffHours: 2,
} as const

export type ProductPolicy = {
  cancelWindowHours: number
  bookingCutoffHours: number
}

const within = (
  value: unknown,
  bounds: { min: number; max: number }
): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= bounds.min &&
  value <= bounds.max

/**
 * Reads a stored `Product.policy` for the code that applies it (booking
 * cutoff, cancellation). Anything missing or out of bounds falls back to the
 * platform default for that field, so a malformed row can never produce a
 * negative window, a float, or `NaN`.
 */
export function parseProductPolicy(stored: unknown): ProductPolicy {
  const raw =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {}

  return {
    cancelWindowHours: within(
      raw.cancelWindowHours,
      POLICY_BOUNDS.cancelWindowHours
    )
      ? raw.cancelWindowHours
      : DEFAULT_POLICY.cancelWindowHours,
    bookingCutoffHours: within(
      raw.bookingCutoffHours,
      POLICY_BOUNDS.bookingCutoffHours
    )
      ? raw.bookingCutoffHours
      : DEFAULT_POLICY.bookingCutoffHours,
  }
}
