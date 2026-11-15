import { randomUUID } from "node:crypto"
import type { EmailDelivery, EmailMessage, EmailSender } from "./types"

/** Brevo transactional email endpoint (API v3). */
export const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"

export type BrevoSenderOptions = {
  apiKey: string
  from: { email: string; name?: string }
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch
  endpoint?: string
  timeoutMs?: number
}

type BrevoPayload = {
  sender: { email: string; name?: string }
  to: Array<{ email: string }>
  subject: string
  htmlContent: string
  textContent?: string
  replyTo?: { email: string }
  tags?: string[]
}

export function brevoPayload(
  from: BrevoSenderOptions["from"],
  message: EmailMessage
): BrevoPayload {
  return {
    sender: { email: from.email, ...(from.name ? { name: from.name } : {}) },
    to: [{ email: message.to }],
    subject: message.subject,
    htmlContent: message.html,
    ...(message.text ? { textContent: message.text } : {}),
    ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
    ...(message.tags
      ? {
          tags: Object.entries(message.tags).map(
            ([key, value]) => `${key}:${value}`
          ),
        }
      : {}),
  }
}

/**
 * Sends transactional email through Brevo.
 *
 * The `EmailSender` contract is provider-agnostic: swapping Brevo for Resend
 * later means adding another implementation, not touching producers, the
 * queue or the worker.
 */
export class BrevoEmailSender implements EmailSender {
  private readonly apiKey: string
  private readonly from: BrevoSenderOptions["from"]
  private readonly fetchImplementation: typeof fetch
  private readonly endpoint: string
  private readonly timeoutMs: number

  constructor(options: BrevoSenderOptions) {
    if (!options.apiKey) {
      throw new Error("BrevoEmailSender requires an API key (BREVO_API_KEY)")
    }

    if (!options.from?.email) {
      throw new Error("BrevoEmailSender requires a sender address (EMAIL_FROM)")
    }

    this.apiKey = options.apiKey
    this.from = options.from
    this.fetchImplementation = options.fetch ?? fetch
    this.endpoint = options.endpoint ?? BREVO_ENDPOINT
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async send(message: EmailMessage): Promise<EmailDelivery> {
    let response: Response

    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify(brevoPayload(this.from, message)),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      // Network/timeout: transient, so the worker should let pg-boss retry.
      throw new Error(`Brevo request failed: ${describe(error)}`)
    }

    if (!response.ok) {
      // 4xx will not succeed on retry either, but a permanent-failure signal
      // does not exist in the queue contract; the job exhausts its retries.
      const body = await safeText(response)
      throw new Error(
        `Brevo rejected the email (${response.status}): ${truncate(body)}`
      )
    }

    const payload = await safeJson(response)
    const messageId =
      payload && typeof payload.messageId === "string"
        ? payload.messageId
        : randomUUID()

    return { id: messageId }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ""
  }
}

async function safeJson(
  response: Response
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json()
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
