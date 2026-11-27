import type { PgBoss } from "pg-boss"
import type { EmailSender } from "@/lib/email/types"
import { consoleJobLogger, type JobLogger } from "./logger"
import { holdExpiryJobSchema } from "./hold-expiry"
import { emailSendJobSchema, QUEUES, QUEUE_OPTIONS } from "./queues"

export type WorkerDependencies = {
  emailSender: EmailSender
  /** Gives a hold's places back once it has expired (E2-S1-03). */
  releaseHold?: (holdId: string) => Promise<unknown>
  logger?: JobLogger
}

/** Idempotent: pg-boss ignores a queue that already exists. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
    await boss.createQueue(name, options)
  }
}

export async function registerWorkers(
  boss: PgBoss,
  dependencies: WorkerDependencies
): Promise<void> {
  const logger = dependencies.logger ?? consoleJobLogger

  await ensureQueues(boss)

  await boss.work(
    QUEUES.emailSend,
    { batchSize: 1, pollingIntervalSeconds: 1 },
    async ([job]) => {
      try {
        const payload = emailSendJobSchema.parse(job.data)
        await dependencies.emailSender.send(payload)
        logger.info("email.send completed", { jobId: job.id })
      } catch (error) {
        // Rethrow so pg-boss applies the queue's retry policy.
        logger.error("email.send failed", error, { jobId: job.id })
        throw error
      }
    }
  )

  if (dependencies.releaseHold) {
    const releaseHold = dependencies.releaseHold

    await boss.work(
      QUEUES.holdExpire,
      { batchSize: 1, pollingIntervalSeconds: 1 },
      async ([job]) => {
        try {
          const payload = holdExpiryJobSchema.parse(job.data)
          await releaseHold(payload.holdId)
          logger.info("hold.expire completed", { jobId: job.id })
        } catch (error) {
          logger.error("hold.expire failed", error, { jobId: job.id })
          throw error
        }
      }
    )
  }
}
