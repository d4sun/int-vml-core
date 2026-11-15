import { z } from "zod"
import type { QueueOptions } from "pg-boss"

export const QUEUES = {
  emailSend: "email.send",
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

/**
 * Payload validation at the worker boundary: a malformed payload fails the job
 * with a clear error instead of reaching a sender.
 */
export const emailSendJobSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1).optional(),
  replyTo: z.email().optional(),
  tags: z.record(z.string(), z.string()).optional(),
})

export type EmailSendJob = z.infer<typeof emailSendJobSchema>

/**
 * Queue-level defaults; a producer may override retry settings per job.
 */
export const QUEUE_OPTIONS: Record<QueueName, QueueOptions> = {
  [QUEUES.emailSend]: {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 300,
    deleteAfterSeconds: 86_400,
  },
}
