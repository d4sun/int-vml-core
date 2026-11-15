import type { EmailMessage } from "./types"

/**
 * Durable email queue contract.
 *
 * Producers (verification, password reset, booking confirmation, refund)
 * depend on this interface only. Runtime wiring uses the pg-boss
 * implementation; unit tests use the in-process implementation.
 */
export interface EmailQueue {
  /** Enqueues one message and returns the queue job id. */
  enqueue(message: EmailMessage): Promise<string>
}
