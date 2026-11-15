import { randomUUID } from "node:crypto"
import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import type { EmailDelivery, EmailMessage, EmailSender } from "./types"

/**
 * Development/test sender that appends one JSON line per email to
 * `EMAIL_OUTBOX_DIR/outbox.jsonl`. The e2e suite reads this file.
 *
 * Refuses to run in production so a misconfigured deployment cannot silently
 * swallow real email.
 */
export class FileEmailSender implements EmailSender {
  private readonly directory: string

  constructor(directory = process.env.EMAIL_OUTBOX_DIR) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FileEmailSender is not available in production")
    }
    if (!directory) {
      throw new Error("EMAIL_OUTBOX_DIR is required for FileEmailSender")
    }
    this.directory = directory
  }

  async send(message: EmailMessage): Promise<EmailDelivery> {
    const id = randomUUID()
    const record = { id, sentAt: new Date().toISOString(), ...message }

    await mkdir(this.directory, { recursive: true })
    await appendFile(
      path.join(this.directory, "outbox.jsonl"),
      `${JSON.stringify(record)}\n`,
      "utf8"
    )

    return { id }
  }
}
