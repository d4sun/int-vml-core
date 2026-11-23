import type { Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"
import {
  StripeSignatureError,
  type StripeAdapter,
  type StripeWebhookEvent,
} from "@/lib/stripe/adapter"

/**
 * A handler runs inside the same database transaction that records the event,
 * so "the event was processed" and "its effects were saved" are one fact: if
 * the handler throws, the record is rolled back with its effects and Stripe's
 * retry is processed afresh. Handlers must only write through `tx`, and must
 * do no network calls (a slow handler holds the transaction open).
 */
export type StripeEventHandler = (
  event: StripeWebhookEvent,
  tx: Prisma.TransactionClient
) => Promise<void>

/** Event type to handler. Later stories register theirs here. */
export type StripeHandlerTable = Readonly<Record<string, StripeEventHandler>>

export type WebhookResult =
  | { status: 200; body: { received: true; result: WebhookDisposition } }
  | { status: 400; body: { error: "invalid_signature" | "invalid_payload" } }
  | { status: 500; body: { error: "processing_failed" } }

export type WebhookDisposition = "processed" | "duplicate" | "ignored"

export type WebhookLogger = {
  error(message: string, error: unknown, meta?: Record<string, unknown>): void
}

const consoleWebhookLogger: WebhookLogger = {
  error(message, error, meta) {
    console.error(`[stripe-webhook] ${message}`, error, meta ?? "")
  },
}

export type StripeWebhookDeps = {
  stripe?: StripeAdapter
  db?: Pick<PrismaClient, "$transaction">
  handlers?: StripeHandlerTable
  logger?: WebhookLogger
}

const eventEnvelope = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
})

/**
 * Receives a Stripe webhook (CR-4: webhooks are authoritative).
 *
 * 1. The signature is verified over the **raw** body before anything is
 *    parsed or trusted; a bad one is a 400 and nothing else happens.
 * 2. Types nobody handles are acknowledged and not stored, so Stripe does not
 *    retry them.
 * 3. The event id is inserted first, under a unique constraint, in the same
 *    transaction as the handler. A second delivery of the same event finds
 *    the row and does nothing (200), however many arrive and however fast.
 *    Two deliveries at once serialise on the unique index.
 * 4. A failing handler rolls the whole transaction back and answers 500, so
 *    Stripe retries and the event is not lost or half applied.
 */
export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
  deps: StripeWebhookDeps = {}
): Promise<WebhookResult> {
  const stripe = deps.stripe ?? (await import("@/lib/stripe")).getStripe()

  let event: StripeWebhookEvent

  try {
    event = stripe.constructWebhookEvent(rawBody, signature)
  } catch (error) {
    if (error instanceof StripeSignatureError) {
      return { status: 400, body: { error: "invalid_signature" } }
    }

    return { status: 400, body: { error: "invalid_payload" } }
  }

  const envelope = eventEnvelope.safeParse(event)

  if (!envelope.success) {
    return { status: 400, body: { error: "invalid_payload" } }
  }

  const handlers = deps.handlers ?? (await defaultHandlers())
  const handler = Object.hasOwn(handlers, envelope.data.type)
    ? handlers[envelope.data.type]
    : undefined

  if (!handler) {
    return { status: 200, body: { received: true, result: "ignored" } }
  }

  const db = deps.db ?? (await import("@/lib/prisma")).prisma
  const logger = deps.logger ?? consoleWebhookLogger

  try {
    const result = await db.$transaction(async (tx) => {
      const { count } = await tx.webhookEvent.createMany({
        data: [{ stripeEventId: envelope.data.id, type: envelope.data.type }],
        skipDuplicates: true,
      })

      if (count === 0) return "duplicate" as const

      await handler(event, tx)

      return "processed" as const
    })

    return { status: 200, body: { received: true, result } }
  } catch (error) {
    logger.error("Webhook handler failed", error, {
      eventId: envelope.data.id,
      type: envelope.data.type,
    })

    return { status: 500, body: { error: "processing_failed" } }
  }
}

async function defaultHandlers(): Promise<StripeHandlerTable> {
  return (await import("@/lib/webhooks/handlers")).stripeHandlers
}
