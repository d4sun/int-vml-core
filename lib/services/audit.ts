import type { Prisma } from "@prisma/client"

export type AuditEntry = {
  /** The admin (or other actor) who did it; `null` for system actions. */
  actorId: string | null
  /** Dotted verb, e.g. `vendor.approved`. */
  action: string
  entityType: string
  entityId: string
  meta?: Prisma.InputJsonValue
}

/** The slice of a Prisma transaction the audit helper needs. */
export type AuditClient = Pick<Prisma.TransactionClient, "auditLog">

/**
 * Writes one audit row (and returns its id) through the caller's transaction client, so the row
 * commits or rolls back together with the change it describes. Never call it
 * with the global client for a state change: that would break the guarantee.
 */
async function record(tx: AuditClient, entry: AuditEntry): Promise<string> {
  const row = await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      ...(entry.meta === undefined ? {} : { meta: entry.meta }),
    },
    select: { id: true },
  })

  return row.id
}

export const audit = { record }
