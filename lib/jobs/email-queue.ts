import type { Prisma } from "@prisma/client"
import type { PgBoss } from "pg-boss"
import type { EmailQueue } from "@/lib/email/queue"
import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import type { EmailMessage } from "@/lib/email/types"
import { prismaTransactionDb } from "./prisma-db"
import { emailSendJobSchema, QUEUES } from "./queues"

export type EmailQueueOptions = {
  retryLimit?: number
  retryDelay?: number
  retryBackoff?: boolean
  expireInSeconds?: number
}

export const EMAIL_QUEUE_DEFAULTS: Required<EmailQueueOptions> = {
  retryLimit: 5,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 300,
}

/**
 * Durable email queue backed by pg-boss. The payload is validated on the way
 * in and again in the worker, so a schema change cannot deliver half a message.
 */
export class PgBossEmailQueue implements EmailQueue, TransactionalEmailQueue {
  constructor(
    private readonly boss: Pick<PgBoss, "send">,
    private readonly options: EmailQueueOptions = {}
  ) {}

  async enqueue(message: EmailMessage): Promise<string> {
    const payload = emailSendJobSchema.parse(message)

    const jobId = await this.boss.send(QUEUES.emailSend, payload, {
      retryLimit: this.options.retryLimit ?? EMAIL_QUEUE_DEFAULTS.retryLimit,
      retryDelay: this.options.retryDelay ?? EMAIL_QUEUE_DEFAULTS.retryDelay,
      retryBackoff:
        this.options.retryBackoff ?? EMAIL_QUEUE_DEFAULTS.retryBackoff,
      expireInSeconds:
        this.options.expireInSeconds ?? EMAIL_QUEUE_DEFAULTS.expireInSeconds,
    })

    if (!jobId) {
      throw new Error("pg-boss did not return a job id for the email job")
    }

    return jobId
  }

  async enqueueInTransaction(
    tx: Pick<Prisma.TransactionClient, "$queryRawUnsafe">,
    message: EmailMessage,
    id: string
  ): Promise<boolean> {
    const payload = emailSendJobSchema.parse(message)

    const jobId = await this.boss.send(QUEUES.emailSend, payload, {
      id,
      db: prismaTransactionDb(tx),
      retryLimit: this.options.retryLimit ?? EMAIL_QUEUE_DEFAULTS.retryLimit,
      retryDelay: this.options.retryDelay ?? EMAIL_QUEUE_DEFAULTS.retryDelay,
      retryBackoff:
        this.options.retryBackoff ?? EMAIL_QUEUE_DEFAULTS.retryBackoff,
      expireInSeconds:
        this.options.expireInSeconds ?? EMAIL_QUEUE_DEFAULTS.expireInSeconds,
    })

    // pg-boss returns null when the insert was skipped because `id` exists.
    return jobId !== null
  }
}
