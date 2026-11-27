/**
 * The platform's default commission, in basis points (1000 is 10%). It is the
 * last resort in the rate lookup. The schema default for categories is the same
 * value; whether it should change is still an open decision (D5).
 */
export const PLATFORM_DEFAULT_COMMISSION_BPS = 1000

/**
 * The commission rate that applies to a vendor's sales in a category, in
 * basis points. The order is fixed (E2-S1 cases): the vendor's own override
 * wins when it is set; otherwise the category's default; otherwise the
 * platform default.
 */
export function effectiveCommissionBps(input: {
  vendorOverrideBps: number | null
  categoryDefaultBps: number | null
  platformDefaultBps?: number
}): { bps: number; source: "VENDOR" | "CATEGORY" | "PLATFORM" } {
  if (input.vendorOverrideBps !== null) {
    return { bps: input.vendorOverrideBps, source: "VENDOR" }
  }

  if (input.categoryDefaultBps !== null) {
    return { bps: input.categoryDefaultBps, source: "CATEGORY" }
  }

  return {
    bps: input.platformDefaultBps ?? PLATFORM_DEFAULT_COMMISSION_BPS,
    source: "PLATFORM",
  }
}
