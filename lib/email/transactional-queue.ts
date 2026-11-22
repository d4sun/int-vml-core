import type { Prisma } from "@prisma/client"
import type { EmailMessage } from "./types"

/**
 * An email queue that can enqueue inside the caller's database transaction.
 *
 * The job then commits or rolls back with the state change that caused it, so
 * a transition cannot be saved without its email, or email a change that was
 * rolled back (CR-7). `id` makes it idempotent: enqueuing the same id again
 * creates nothing.
 */
export interface TransactionalEmailQueue {
  /** Returns `true` when a job was created, `false` when `id` already existed. */
  enqueueInTransaction(
    tx: Pick<Prisma.TransactionClient, "$queryRawUnsafe">,
    message: EmailMessage,
    id: string
  ): Promise<boolean>
}
