import { randomUUID } from "node:crypto"
import type {
  EmailDelivery,
  EmailMessage,
  EmailSender,
} from "@/lib/email/types"

/**
 * Test sender that records deliveries and can be told to fail, so retry and
 * failure paths can be exercised without a provider.
 */
export class RecordingEmailSender implements EmailSender {
  messages: EmailMessage[] = []
  attempts = 0
  failNext = 0
  failSubject?: string

  async send(message: EmailMessage): Promise<EmailDelivery> {
    this.attempts += 1

    if (this.failSubject && message.subject === this.failSubject) {
      throw new Error(`simulated send failure for subject "${message.subject}"`)
    }

    if (this.failNext > 0) {
      this.failNext -= 1
      throw new Error("simulated send failure")
    }

    this.messages.push({ ...message })

    return { id: randomUUID() }
  }
}
