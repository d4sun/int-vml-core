/**
 * Commission on a sale, in whole pence (CR-5). Rounding is half to even
 * ("banker's" rounding), decided 2026-11-28: a half penny goes to the nearest
 * even penny, so over many sales the rounding does not drift in either
 * direction. Pure integer arithmetic: no floats touch the money.
 */

const BASIS_POINTS = BigInt(10_000)
const TWO = BigInt(2)
const ONE = BigInt(1)

/**
 * The commission on `subtotalPence` at `bps` basis points (1000 is 10%).
 * Throws when the inputs are not whole, non-negative numbers, or the result
 * would not be a safe integer.
 */
export function commissionAmount(subtotalPence: number, bps: number): number {
  if (!Number.isSafeInteger(subtotalPence) || subtotalPence < 0) {
    throw new RangeError("subtotal must be whole, non-negative pence")
  }

  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) {
    throw new RangeError(
      "commission must be whole basis points from 0 to 10000"
    )
  }

  const product = BigInt(subtotalPence) * BigInt(bps)
  const quotient = product / BASIS_POINTS
  const remainder = product % BASIS_POINTS
  const twice = remainder * TWO

  let rounded = quotient

  if (
    twice > BASIS_POINTS ||
    (twice === BASIS_POINTS && quotient % TWO === ONE)
  ) {
    rounded = quotient + ONE
  }

  return Number(rounded)
}

/** The commission part of a subtotal, and the part that stays with the vendor. */
export function splitSale(
  subtotalPence: number,
  bps: number
): { commission: number; vendorShare: number } {
  const commission = commissionAmount(subtotalPence, bps)

  return { commission, vendorShare: subtotalPence - commission }
}
