import { randomUUID } from "node:crypto"
import type { EmailQueue } from "./queue"
import type { EmailMessage } from "./types"

/**
 * Non-durable queue for unit tests. Never use this outside tests: a process
 * restart would drop the pending messages.
 */
export class InProcessEmailQueue implements EmailQueue {
  readonly messages: EmailMessage[] = []

  async enqueue(message: EmailMessage): Promise<string> {
    this.messages.push({ ...message })
    return randomUUID()
  }

  clear(): void {
    this.messages.length = 0
  }
}
