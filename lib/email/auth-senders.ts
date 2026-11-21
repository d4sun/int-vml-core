import type { EmailQueue } from "./queue"
import { passwordResetEmail, verificationEmail } from "./templates"
import type { EmailMessage } from "./types"

/**
 * The subset of Better Auth's user object the templates need. Keeping this
 * structural (instead of importing Better Auth types) means the email layer
 * does not depend on the auth library.
 */
export type AuthEmailUser = {
  email: string
  name?: string | null
}

/** Matches Better Auth's `sendVerificationEmail` / `sendResetPassword` data. */
export type AuthEmailParams = {
  user: AuthEmailUser
  url: string
  token: string
}

export type AuthEmailSenders = {
  sendVerificationEmail(params: AuthEmailParams): Promise<void>
  sendResetPassword(params: AuthEmailParams): Promise<void>
}

export type AuthEmailSenderOptions = {
  /** Optional reply-to address, usually a support inbox. */
  replyTo?: string
}

/**
 * Builds the auth email callbacks around a durable `EmailQueue`.
 *
 * E0-S1-03 ships the senders and their unit tests; E0-S1-02 passes them to
 * `betterAuth()` (`emailVerification.sendVerificationEmail` and
 * `emailAndPassword.sendResetPassword`). Enqueue failures reject on purpose.
 * Better Auth awaits the resend endpoint, so a failure surfaces there, but it
 * runs the sign-up send as a background task and only logs a failure, so
 * sign-up during an outage succeeds without mail and relies on resend.
 */
export function createAuthEmailSenders(
  queue: EmailQueue,
  options: AuthEmailSenderOptions = {}
): AuthEmailSenders {
  async function enqueue(message: EmailMessage): Promise<void> {
    await queue.enqueue({
      ...message,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    })
  }

  return {
    async sendVerificationEmail({ user, url }) {
      const { subject, html, text } = verificationEmail({
        name: user.name,
        url,
      })

      await enqueue({
        to: user.email,
        subject,
        html,
        text,
        tags: { kind: "verification" },
      })
    },

    async sendResetPassword({ user, url }) {
      const { subject, html, text } = passwordResetEmail({
        name: user.name,
        url,
      })

      await enqueue({
        to: user.email,
        subject,
        html,
        text,
        tags: { kind: "password-reset" },
      })
    },
  }
}
