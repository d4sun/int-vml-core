import type { PrismaClient } from "@prisma/client"
import type { SessionSource } from "@/lib/auth/guards"
import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import type { EmailMessage } from "@/lib/email/types"

/**
 * Test double that records what would be enqueued, with the same
 * "same id twice creates nothing" rule as the real queue. It does not touch
 * the transaction, so use the real queue to test atomicity.
 */
export class RecordingTransactionalQueue implements TransactionalEmailQueue {
  readonly jobs = new Map<string, EmailMessage>()

  async enqueueInTransaction(
    _tx: unknown,
    message: EmailMessage,
    id: string
  ): Promise<boolean> {
    if (this.jobs.has(id)) return false

    this.jobs.set(id, { ...message })

    return true
  }

  get messages(): EmailMessage[] {
    return [...this.jobs.values()]
  }
}

export const TEST_APP_URL = "http://localhost:3000"

/** Dependencies for `transitionVendor` in integration tests. */
export function governanceDeps(
  session: SessionSource,
  db: PrismaClient,
  emailQueue: TransactionalEmailQueue = new RecordingTransactionalQueue()
) {
  return { session, db, emailQueue, appUrl: TEST_APP_URL }
}
