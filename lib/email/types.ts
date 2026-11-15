/**
 * Transport-agnostic email types.
 *
 * The queue, the sender and the templates all share this shape so that the
 * pg-boss job payload, the in-process test double and the real provider
 * payload stay in sync.
 */
export type EmailMessage = {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  tags?: Record<string, string>
}

export type EmailDelivery = {
  id: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailDelivery>
}
