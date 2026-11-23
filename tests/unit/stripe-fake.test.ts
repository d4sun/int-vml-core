import { describe, expect, it } from "vitest"
import {
  StripeAccountNotFoundError,
  StripeIdempotencyError,
  StripeSignatureError,
} from "@/lib/stripe/adapter"
import { FakeStripe } from "@/lib/stripe/fake"
import { signPayload } from "@/lib/stripe/signature"

const links = {
  refreshUrl: "https://vml.test/vendor/payouts/setup?refresh=1",
  returnUrl: "https://vml.test/vendor/payouts/setup?return=1",
}

describe("FakeStripe accounts", () => {
  it("E4-S2-01: a new account cannot take charges or payouts yet", async () => {
    const stripe = new FakeStripe()
    const account = await stripe.createConnectAccount({ vendorId: "v1" })

    expect(account.id).toMatch(/^acct_fake_/)
    expect(account.chargesEnabled).toBe(false)
    expect(account.payoutsEnabled).toBe(false)
    expect(account.detailsSubmitted).toBe(false)
    expect(account.currentlyDue.length).toBeGreaterThan(0)
  })

  it("E4-S2-01: replays the stored account for a repeated idempotency key", async () => {
    const stripe = new FakeStripe()
    const first = await stripe.createConnectAccount(
      { vendorId: "v1" },
      { idempotencyKey: "k1" }
    )
    const again = await stripe.createConnectAccount(
      { vendorId: "v1" },
      { idempotencyKey: "k1" }
    )
    const other = await stripe.createConnectAccount(
      { vendorId: "v1" },
      { idempotencyKey: "k2" }
    )

    expect(again.id).toBe(first.id)
    expect(other.id).not.toBe(first.id)
  })

  it("rejects an idempotency key reused with different parameters", async () => {
    const stripe = new FakeStripe()

    await stripe.createConnectAccount(
      { vendorId: "v1" },
      { idempotencyKey: "k" }
    )

    await expect(
      stripe.createConnectAccount({ vendorId: "v2" }, { idempotencyKey: "k" })
    ).rejects.toBeInstanceOf(StripeIdempotencyError)
  })

  it("without a key every call makes a new account", async () => {
    const stripe = new FakeStripe()
    const a = await stripe.createConnectAccount({ vendorId: "v1" })
    const b = await stripe.createConnectAccount({ vendorId: "v1" })

    expect(a.id).not.toBe(b.id)
  })

  it("returns copies, so callers cannot change Stripe's state", async () => {
    const stripe = new FakeStripe()
    const account = await stripe.createConnectAccount({ vendorId: "v1" })

    account.chargesEnabled = true
    account.payoutsEnabled = true

    const stored = await stripe.retrieveConnectAccount(account.id)

    expect(stored.chargesEnabled).toBe(false)
    expect(stored.payoutsEnabled).toBe(false)
  })

  it("retrieving an unknown account fails with a typed error", async () => {
    const stripe = new FakeStripe()

    await expect(
      stripe.retrieveConnectAccount("acct_missing")
    ).rejects.toBeInstanceOf(StripeAccountNotFoundError)
  })

  it("E4-S2-01: completing onboarding enables both capabilities and clears requirements", async () => {
    const stripe = new FakeStripe()
    const { id } = await stripe.createConnectAccount({ vendorId: "v1" })

    stripe.completeOnboarding(id)

    expect(await stripe.retrieveConnectAccount(id)).toEqual({
      id,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      currentlyDue: [],
      pastDue: [],
      disabledReason: null,
    })
  })

  it("E4-S2-01: charges can be on while payouts stay off", async () => {
    const stripe = new FakeStripe()
    const { id } = await stripe.createConnectAccount({ vendorId: "v1" })

    stripe.setAccount(id, { chargesEnabled: true })

    const account = await stripe.retrieveConnectAccount(id)

    expect(account.chargesEnabled).toBe(true)
    expect(account.payoutsEnabled).toBe(false)
  })
})

describe("FakeStripe account links", () => {
  it("returns a link that expires after the configured lifetime", async () => {
    const now = new Date("2026-06-01T10:00:00Z")
    const stripe = new FakeStripe({ now: () => now, linkTtlMs: 60_000 })
    const { id } = await stripe.createConnectAccount({ vendorId: "v1" })
    const link = await stripe.createAccountLink({ accountId: id, ...links })

    expect(link.url).toContain(id)
    expect(link.expiresAt.toISOString()).toBe("2026-06-01T10:01:00.000Z")
  })

  it("will not link an account that does not exist", async () => {
    const stripe = new FakeStripe()

    await expect(
      stripe.createAccountLink({ accountId: "acct_missing", ...links })
    ).rejects.toBeInstanceOf(StripeAccountNotFoundError)
  })

  it("replays a link for a repeated idempotency key", async () => {
    const stripe = new FakeStripe()
    const { id } = await stripe.createConnectAccount({ vendorId: "v1" })
    const first = await stripe.createAccountLink(
      { accountId: id, ...links },
      { idempotencyKey: "link-1" }
    )
    const again = await stripe.createAccountLink(
      { accountId: id, ...links },
      { idempotencyKey: "link-1" }
    )

    expect(again).toEqual(first)
  })
})

describe("FakeStripe webhook verification", () => {
  const body = JSON.stringify({
    id: "evt_1",
    type: "account.updated",
    created: 1,
    data: { object: {} },
  })

  it("TC-E2S3-06: accepts a correctly signed body and returns the event", () => {
    const stripe = new FakeStripe()
    const event = stripe.constructWebhookEvent(
      body,
      signPayload(body, stripe.webhookSecret)
    )

    expect(event.id).toBe("evt_1")
    expect(event.type).toBe("account.updated")
  })

  it("TC-E2S3-06: rejects a missing signature header", () => {
    const stripe = new FakeStripe()

    expect(() => stripe.constructWebhookEvent(body, null)).toThrow(
      StripeSignatureError
    )
  })

  it("TC-E2S3-06: rejects a body changed after signing", () => {
    const stripe = new FakeStripe()
    const signature = signPayload(body, stripe.webhookSecret)

    expect(() =>
      stripe.constructWebhookEvent(body.replace("evt_1", "evt_2"), signature)
    ).toThrow(StripeSignatureError)
  })

  it("TC-E2S3-06: rejects a signature made with another secret", () => {
    const stripe = new FakeStripe()

    expect(() =>
      stripe.constructWebhookEvent(body, signPayload(body, "whsec_other"))
    ).toThrow(StripeSignatureError)
  })

  it.each(["", "garbage", "t=abc,v1=00", "t=1700000000", "v1=00"])(
    "TC-E2S3-06: rejects malformed header %j",
    (header) => {
      const stripe = new FakeStripe()

      expect(() => stripe.constructWebhookEvent(body, header)).toThrow(
        StripeSignatureError
      )
    }
  )

  it("rejects a valid signature outside the five minute tolerance, both ways", () => {
    const now = new Date("2026-06-01T10:00:00Z")
    const stripe = new FakeStripe({ now: () => now })
    const at = Math.floor(now.getTime() / 1000)

    expect(() =>
      stripe.constructWebhookEvent(
        body,
        signPayload(body, stripe.webhookSecret, at - 301)
      )
    ).toThrow(StripeSignatureError)
    expect(() =>
      stripe.constructWebhookEvent(
        body,
        signPayload(body, stripe.webhookSecret, at + 301)
      )
    ).toThrow(StripeSignatureError)
    expect(
      stripe.constructWebhookEvent(
        body,
        signPayload(body, stripe.webhookSecret, at - 299)
      ).id
    ).toBe("evt_1")
  })

  it("accepts a signature when any v1 entry matches (secret rotation)", () => {
    const stripe = new FakeStripe()
    const good = signPayload(body, stripe.webhookSecret)
    const stale = signPayload(body, "whsec_old")
    const timestamp = good.split(",")[0]
    const header = `${timestamp},v1=${stale.split("v1=")[1]},${good.split(",")[1]}`

    expect(stripe.constructWebhookEvent(body, header).id).toBe("evt_1")
  })

  it("signedAccountUpdated produces an event the adapter accepts", async () => {
    const stripe = new FakeStripe()
    const { id } = await stripe.createConnectAccount({ vendorId: "v1" })

    stripe.completeOnboarding(id)

    const { rawBody, signature } = stripe.signedAccountUpdated(id, "evt_9")
    const event = stripe.constructWebhookEvent(rawBody, signature)

    expect(event.id).toBe("evt_9")
    expect(event.data.object).toMatchObject({
      id,
      charges_enabled: true,
      payouts_enabled: true,
    })
  })
})
