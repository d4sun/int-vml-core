/**
 * A pounds amount typed into a form, as whole pence. Accepts "12", "12.5",
 * "12.50" and a leading "£". Anything else (negative, more than two decimals,
 * words) gives NaN, which the validation rejects.
 */
export function poundsToPence(text: string): number {
  const trimmed = text.trim().replace(/^£/, "").trim()

  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) return Number.NaN

  const [whole = "0", fraction = ""] = trimmed.split(".")

  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
}
