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

/**
 * `amount × part / whole` in whole pence, half to even, like the commission
 * above. Used to take a fair share of a refund (E10-S1-02): the commission
 * part of a refund is proportional to the commission on the whole item.
 */
export function proportionalAmount(
  amount: number,
  part: number,
  whole: number
): number {
  if (
    !Number.isSafeInteger(amount) ||
    !Number.isSafeInteger(part) ||
    !Number.isSafeInteger(whole) ||
    amount < 0 ||
    part < 0 ||
    whole <= 0
  ) {
    throw new RangeError(
      "amounts must be whole, non-negative pence (whole > 0)"
    )
  }

  const product = BigInt(amount) * BigInt(part)
  const denominator = BigInt(whole)
  const quotient = product / denominator
  const remainder = product % denominator
  const twice = remainder * TWO
  let rounded = quotient

  if (
    twice > denominator ||
    (twice === denominator && quotient % TWO === ONE)
  ) {
    rounded = quotient + ONE
  }

  return Number(rounded)
}

/**
 * The commission part of one refund, when an item is refunded in several
 * parts (E10-S1-04). It is the commission on the running refunded total
 * after this refund, less the commission on the total before it. The parts
 * therefore add up to exactly the commission on whatever has been refunded,
 * so the shares reconcile to the penny; a single rounding per refund would
 * drift.
 */
export function refundCommissionShare(
  refundedBefore: number,
  refundAmount: number,
  subtotal: number,
  commission: number
): number {
  const after = refundedBefore + refundAmount

  if (after > subtotal) {
    throw new RangeError("refunds cannot exceed the subtotal")
  }

  return (
    proportionalAmount(after, commission, subtotal) -
    proportionalAmount(refundedBefore, commission, subtotal)
  )
}
