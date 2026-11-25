/**
 * The editor shows commission as a percentage; the service stores whole basis
 * points. Only plain decimals with at most two places are accepted, so
 * `12.5` is 1250 and `12.345` is rejected instead of being rounded silently.
 * Anything else gives `NaN`, which the schema reports as "Enter a number".
 */
export function percentToBps(text: string): number {
  const trimmed = text.trim()

  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return Number.NaN

  return Math.round(Number(trimmed) * 100)
}

/** 1000 becomes "10", 1250 becomes "12.5", 5 becomes "0.05". */
export function bpsToPercent(bps: number): string {
  return String(bps / 100)
}
