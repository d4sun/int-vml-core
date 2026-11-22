import { createHash } from "node:crypto"

/**
 * A UUID derived from `seed`: the same seed always gives the same id, and
 * different seeds give different ids. Used as a pg-boss job id so enqueuing
 * the same logical email twice inserts one job, not two.
 */
export function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(seed).digest().subarray(0, 16)
  )

  bytes[6] = (bytes[6]! & 0x0f) | 0x50 // version 5 layout
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC 4122 variant

  const hex = bytes.toString("hex")

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
