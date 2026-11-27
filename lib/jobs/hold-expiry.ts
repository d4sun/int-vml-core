import type { PgBoss } from "pg-boss"
import { z } from "zod"
import { QUEUES } from "./queues"

/** Validated at the worker boundary, like every job payload. */
export const holdExpiryJobSchema = z.object({ holdId: z.string().min(1) })

export type HoldExpiryJob = z.infer<typeof holdExpiryJobSchema>

/**
 * Schedules a hold's release for the moment it expires. `singletonKey` makes
 * the schedule itself idempotent: asking twice for the same hold queues one job.
 * The release is also idempotent (see `releaseHold`), so a late or repeated job
 * does no harm either way.
 */
export async function scheduleHoldExpiry(
  boss: Pick<PgBoss, "send">,
  hold: { id: string; expiresAt: Date }
): Promise<string | null> {
  const payload: HoldExpiryJob = { holdId: hold.id }

  return boss.send(QUEUES.holdExpire, payload, {
    startAfter: hold.expiresAt,
    singletonKey: `hold-expiry:${hold.id}`,
  })
}
