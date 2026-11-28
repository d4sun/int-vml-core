/** Pence as a pound amount for display: 1250 is "£12.50". Display only; the amount stays in pence (CR-5). */
export function formatPence(pence: number): string {
  const sign = pence < 0 ? "-" : ""

  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`
}
