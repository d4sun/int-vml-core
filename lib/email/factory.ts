import { getEnv } from "../env"
import { BrevoEmailSender } from "./brevo-sender"
import { FileEmailSender } from "./file-sender"
import type { EmailSender } from "./types"

export type EmailEnv = Record<string, string | undefined>

export type EmailTransport = "brevo" | "file"

export type EmailSenderSelection = {
  sender: EmailSender
  transport: EmailTransport
}

/**
 * Chooses the transport once, at worker start:
 *
 * - `BREVO_API_KEY` present → real delivery through Brevo (needs `EMAIL_FROM`).
 * - no key in production → hard failure; silently writing to a file would
 *   drop every verification email.
 * - no key elsewhere → `FileEmailSender` outbox for dev and e2e.
 */
export function createEmailSender(
  env: EmailEnv = getEnv()
): EmailSenderSelection {
  if (env.BREVO_API_KEY) {
    if (!env.EMAIL_FROM) {
      throw new Error("EMAIL_FROM is required when BREVO_API_KEY is set")
    }

    return {
      transport: "brevo",
      sender: new BrevoEmailSender({
        apiKey: env.BREVO_API_KEY,
        from: {
          email: env.EMAIL_FROM,
          ...(env.EMAIL_FROM_NAME ? { name: env.EMAIL_FROM_NAME } : {}),
        },
      }),
    }
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "No email transport configured: set BREVO_API_KEY and EMAIL_FROM"
    )
  }

  return {
    transport: "file",
    sender: new FileEmailSender(env.EMAIL_OUTBOX_DIR),
  }
}
