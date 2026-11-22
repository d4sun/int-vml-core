import { describe, expect, it } from "vitest"
import type { StripeWebhookEvent } from "@/lib/stripe/adapter"
import { FakeStripe } from "@/lib/stripe/fake"
import { signPayload } from "@/lib/stripe/signature"
import {
  handleStripeWebhook,
  type StripeEventHandler,
  type StripeWebhookDeps,
} from "@/lib/webhooks/stripe"
import {
  MAX_WEBHOOK_BYTES,
  handleWebhookRequest,
} from "@/lib/webhooks/stripe-request"

const event = (id = "evt_1", type = "account.updated"): StripeWebhookEvent => ({
  id,
  type,
  created: 1_780_000_000,
  data: { object: { id: "acct_1" } },
})

/** A database where `webhookEvent.createMany` is unique on the event id. */
function fakeDb() {
  const seen = new Set<string>()
  const log: string[] = []
  const tx = {
    webhookEvent: {
      createMany: async (args: {
        data: { stripeEventId: string }[]
        skipDuplicates: boolean
      }) => {
        log.push("insert")
        expect(args.skipDuplicates).toBe(true)

        let count = 0

        for (const row of args.data) {
          if (!seen.has(row.stripeEventId)) {
            seen.add(row.stripeEventId)
            count += 1
          }
        }

        return { count }
      },
    },
  }

  const db = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      log.push("begin")
      const before = new Set(seen)

      try {
        return await fn(tx)
      } catch (error) {
        seen.clear()
        for (const id of before) seen.add(id)
        log.push("rollback")
        throw error
      }
    },
  } as never

  return { db, seen, log }
}

function setup(handler: StripeEventHandler = async () => {}) {
  const stripe = new FakeStripe()
  const store = fakeDb()
  const calls: StripeWebhookEvent[] = []
  const errors: unknown[] = []
  const deps: StripeWebhookDeps = {
    stripe,
    db: store.db,
    handlers: {
      "account.updated": async (e, tx) => {
        store.log.push("handler")
        calls.push(e)
        await handler(e, tx)
      },
    },
    logger: { error: (_: string, e: unknown) => void errors.push(e) },
  }

  const send = (e: StripeWebhookEvent) => {
    const { rawBody, signature } = stripe.signedEvent(e)

    return handleStripeWebhook(rawBody, signature, deps)
  }

  return { stripe, ...store, calls, errors, deps, send }
}

describe("handleStripeWebhook signature", () => {
  it("TC-E2S3-06: a bad signature is a 400 and nothing is recorded or run", async () => {
    const t = setup()
    const { rawBody } = t.stripe.signedEvent(event())

    for (const header of [
      null,
      "",
      "garbage",
      signPayload(rawBody, "whsec_wrong"),
    ]) {
      const result = await handleStripeWebhook(rawBody, header, t.deps)

      expect(result).toEqual({
        status: 400,
        body: { error: "invalid_signature" },
      })
    }

    expect(t.log).toEqual([])
    expect(t.calls).toEqual([])
  })

  it("TC-E2S3-06: a body changed after signing is rejected", async () => {
    const t = setup()
    const { rawBody, signature } = t.stripe.signedEvent(event("evt_1"))
    const result = await handleStripeWebhook(
      rawBody.replace("evt_1", "evt_2"),
      signature,
      t.deps
    )

    expect(result.status).toBe(400)
    expect(t.calls).toEqual([])
  })

  it("a correctly signed body that is not JSON is a 400, not a crash", async () => {
    const t = setup()
    const body = "not json"
    const result = await handleStripeWebhook(
      body,
      signPayload(body, t.stripe.webhookSecret),
      t.deps
    )

    expect(result).toEqual({ status: 400, body: { error: "invalid_payload" } })
  })

  it.each([
    {},
    { id: "evt_1" },
    { type: "account.updated" },
    { id: "", type: "x" },
  ])(
    "a signed event without a usable id and type (%j) is a 400",
    async (partial) => {
      const t = setup()
      const body = JSON.stringify({ data: { object: {} }, ...partial })
      const result = await handleStripeWebhook(
        body,
        signPayload(body, t.stripe.webhookSecret),
        t.deps
      )

      expect(result).toEqual({
        status: 400,
        body: { error: "invalid_payload" },
      })
      expect(t.log).toEqual([])
    }
  )
})

describe("handleStripeWebhook dispatch and dedupe", () => {
  it("records the event, then runs its handler with the event and the transaction", async () => {
    const t = setup()
    const result = await t.send(event())

    expect(result).toEqual({
      status: 200,
      body: { received: true, result: "processed" },
    })
    expect(t.log).toEqual(["begin", "insert", "handler"])
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0]?.id).toBe("evt_1")
  })

  it("IT-08: a repeated event id is acknowledged and the handler does not run again", async () => {
    const t = setup()

    await t.send(event("evt_1"))

    const again = await t.send(event("evt_1"))

    expect(again).toEqual({
      status: 200,
      body: { received: true, result: "duplicate" },
    })
    expect(t.calls).toHaveLength(1)
  })

  it("different event ids are each processed", async () => {
    const t = setup()

    await t.send(event("evt_1"))
    await t.send(event("evt_2"))

    expect(t.calls.map((c) => c.id)).toEqual(["evt_1", "evt_2"])
  })

  it("an event type nobody handles is acknowledged without being stored", async () => {
    const t = setup()
    const result = await t.send(event("evt_9", "customer.created"))

    expect(result).toEqual({
      status: 200,
      body: { received: true, result: "ignored" },
    })
    expect(t.log).toEqual([])
    expect(t.seen.size).toBe(0)
  })

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "an event type named %s is ignored, never looked up on the prototype",
    async (type) => {
      const t = setup()
      const result = await t.send(event("evt_p", type))

      expect(result).toMatchObject({ status: 200, body: { result: "ignored" } })
      expect(t.log).toEqual([])
    }
  )

  it("a failing handler is a 500 with no detail, is logged, and leaves the event unrecorded so Stripe's retry runs it", async () => {
    let fail = true
    const t = setup(async () => {
      if (fail) throw new Error("secret internal detail")
    })
    const first = await t.send(event("evt_1"))

    expect(first).toEqual({ status: 500, body: { error: "processing_failed" } })
    expect(JSON.stringify(first)).not.toContain("secret")
    expect(t.errors).toHaveLength(1)
    expect(t.seen.has("evt_1")).toBe(false)

    fail = false

    expect(await t.send(event("evt_1"))).toMatchObject({
      status: 200,
      body: { result: "processed" },
    })
    expect(t.calls).toHaveLength(2)
  })
})

describe("handleWebhookRequest", () => {
  const url = "https://vml.test/api/webhooks/stripe"

  it("verifies the exact raw bytes, including whitespace a JSON round trip would remove", async () => {
    const t = setup()
    const raw = `{ "id" : "evt_1",\n  "type":"account.updated", "created":1,\n "data":{"object":{}} }`
    const response = await handleWebhookRequest(
      new Request(url, {
        method: "POST",
        body: raw,
        headers: {
          "stripe-signature": signPayload(raw, t.stripe.webhookSecret),
        },
      }),
      t.deps
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      received: true,
      result: "processed",
    })
  })

  it("answers a missing header with 400 and never caches", async () => {
    const t = setup()
    const response = await handleWebhookRequest(
      new Request(url, { method: "POST", body: "{}" }),
      t.deps
    )

    expect(response.status).toBe(400)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({ error: "invalid_signature" })
  })

  it("rejects an oversized body by its declared length without reading it", async () => {
    const t = setup()
    const response = await handleWebhookRequest(
      new Request(url, {
        method: "POST",
        body: "{}",
        headers: { "content-length": String(MAX_WEBHOOK_BYTES + 1) },
      }),
      t.deps
    )

    expect(response.status).toBe(413)
    expect(t.log).toEqual([])
  })

  it("rejects an oversized body even when no length was declared", async () => {
    const t = setup()
    const response = await handleWebhookRequest(
      new Request(url, {
        method: "POST",
        body: "x".repeat(MAX_WEBHOOK_BYTES + 1),
      }),
      t.deps
    )

    expect(response.status).toBe(413)
  })
})
