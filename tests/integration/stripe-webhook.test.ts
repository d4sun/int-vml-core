import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { StripeWebhookEvent } from "@/lib/stripe/adapter"
import { FakeStripe } from "@/lib/stripe/fake"
import {
  handleStripeWebhook,
  type StripeHandlerTable,
  type StripeWebhookDeps,
} from "@/lib/webhooks/stripe"
import { handleWebhookRequest } from "@/lib/webhooks/stripe-request"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"

let prisma: PrismaClient
let stripe: FakeStripe

beforeAll(() => {
  prisma = createTestPrismaClient()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await truncatePublicSchema(prisma)
  stripe = new FakeStripe()
})

const event = (id: string, type = "account.updated"): StripeWebhookEvent => ({
  id,
  type,
  created: 1_780_000_000,
  data: { object: { id: "acct_1" } },
})

const silent = { error() {} }

/** A handler that leaves a visible mark in the database, to prove atomicity. */
function markingHandlers(options: { failAfterWrite?: () => boolean } = {}) {
  const runs: string[] = []
  const handlers: StripeHandlerTable = {
    "account.updated": async (e, tx) => {
      runs.push(e.id)
      await tx.auditLog.create({
        data: { action: "test.webhook", entityType: "Test", entityId: e.id },
      })

      if (options.failAfterWrite?.()) throw new Error("handler blew up")
    },
  }

  return { handlers, runs }
}

function deps(handlers: StripeHandlerTable): StripeWebhookDeps {
  return { stripe, db: prisma, handlers, logger: silent }
}

const send = (e: StripeWebhookEvent, d: StripeWebhookDeps) => {
  const { rawBody, signature } = stripe.signedEvent(e)

  return handleStripeWebhook(rawBody, signature, d)
}

const rows = () =>
  prisma.webhookEvent.findMany({ orderBy: { stripeEventId: "asc" } })
const marks = () => prisma.auditLog.count({ where: { action: "test.webhook" } })

describe("Stripe webhook on Postgres", () => {
  it("records a processed event with its type, and runs its handler once", async () => {
    const handlers = markingHandlers()
    const result = await send(event("evt_1"), deps(handlers.handlers))

    expect(result).toMatchObject({ status: 200, body: { result: "processed" } })
    expect(handlers.runs).toEqual(["evt_1"])

    const stored = await rows()

    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      stripeEventId: "evt_1",
      type: "account.updated",
    })
    expect(await marks()).toBe(1)
  })

  it("IT-08: the same event delivered again does nothing", async () => {
    const handlers = markingHandlers()
    const d = deps(handlers.handlers)

    await send(event("evt_1"), d)

    const again = await send(event("evt_1"), d)
    const third = await send(event("evt_1"), d)

    expect(again).toMatchObject({ status: 200, body: { result: "duplicate" } })
    expect(third).toMatchObject({ status: 200, body: { result: "duplicate" } })
    expect(handlers.runs).toEqual(["evt_1"])
    expect(await rows()).toHaveLength(1)
    expect(await marks()).toBe(1)
  })

  it("IT-08: simultaneous deliveries of one event run the handler once", async () => {
    const handlers = markingHandlers()
    const d = deps(handlers.handlers)

    const results = await Promise.all([
      send(event("evt_1"), d),
      send(event("evt_1"), d),
      send(event("evt_1"), d),
    ])

    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect(handlers.runs).toEqual(["evt_1"])
    expect(await rows()).toHaveLength(1)
    expect(await marks()).toBe(1)
  })

  it("different events are each processed", async () => {
    const handlers = markingHandlers()
    const d = deps(handlers.handlers)

    await send(event("evt_1"), d)
    await send(event("evt_2"), d)

    expect(handlers.runs).toEqual(["evt_1", "evt_2"])
    expect((await rows()).map((r) => r.stripeEventId)).toEqual([
      "evt_1",
      "evt_2",
    ])
  })

  it("a handler that fails after writing leaves neither its writes nor the event record", async () => {
    let fail = true
    const handlers = markingHandlers({ failAfterWrite: () => fail })
    const d = deps(handlers.handlers)
    const first = await send(event("evt_1"), d)

    expect(first).toEqual({ status: 500, body: { error: "processing_failed" } })
    expect(await rows()).toHaveLength(0)
    expect(await marks()).toBe(0)

    // Stripe retries; this time it succeeds and is processed in full.
    fail = false

    const retry = await send(event("evt_1"), d)

    expect(retry).toMatchObject({ status: 200, body: { result: "processed" } })
    expect(await rows()).toHaveLength(1)
    expect(await marks()).toBe(1)
    expect(handlers.runs).toEqual(["evt_1", "evt_1"])
  })

  it("TC-E2S3-06: a bad signature records nothing and runs nothing", async () => {
    const handlers = markingHandlers()
    const { rawBody } = stripe.signedEvent(event("evt_1"))
    const result = await handleStripeWebhook(
      rawBody,
      "t=1,v1=bad",
      deps(handlers.handlers)
    )

    expect(result).toEqual({
      status: 400,
      body: { error: "invalid_signature" },
    })
    expect(handlers.runs).toEqual([])
    expect(await rows()).toHaveLength(0)
  })

  it("an event type with no handler is acknowledged and not stored", async () => {
    const handlers = markingHandlers()
    const result = await send(
      event("evt_1", "customer.created"),
      deps(handlers.handlers)
    )

    expect(result).toMatchObject({ status: 200, body: { result: "ignored" } })
    expect(await rows()).toHaveLength(0)
  })

  it("the HTTP layer verifies, dedupes and answers with JSON", async () => {
    const handlers = markingHandlers()
    const d = deps(handlers.handlers)
    const { rawBody, signature } = stripe.signedEvent(event("evt_http"))
    const post = () =>
      handleWebhookRequest(
        new Request("https://vml.test/api/webhooks/stripe", {
          method: "POST",
          body: rawBody,
          headers: { "stripe-signature": signature },
        }),
        d
      )

    const first = await post()
    const second = await post()

    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ received: true, result: "processed" })
    expect(await second.json()).toEqual({ received: true, result: "duplicate" })
    expect(handlers.runs).toEqual(["evt_http"])
  })
})
