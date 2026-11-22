import Stripe from "stripe"
import { describe, expect, it } from "vitest"
import {
  StripeAccountNotFoundError,
  StripeIdempotencyError,
  StripeSignatureError,
} from "@/lib/stripe/adapter"
import { FAKE_WEBHOOK_SECRET } from "@/lib/stripe/fake"
import {
  RealStripe,
  mapAccount,
  type StripeClientLike,
} from "@/lib/stripe/real"
import { signPayload } from "@/lib/stripe/signature"

type Call = { method: string; params: unknown; options: unknown }

function stubClient(overrides: Partial<StripeClientLike> = {}) {
  const calls: Call[] = []

  const client: StripeClientLike = {
    accounts: {
      async create(params, options) {
        calls.push({ method: "accounts.create", params, options })
        return {
          id: "acct_123",
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          requirements: {
            currently_due: ["external_account"],
            past_due: [],
            disabled_reason: "requirements.past_due",
          },
        }
      },
      async retrieve(accountId) {
        calls.push({
          method: "accounts.retrieve",
          params: accountId,
          options: undefined,
        })
        return {
          id: accountId,
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          requirements: null,
        }
      },
    },
    accountLinks: {
      async create(params, options) {
        calls.push({ method: "accountLinks.create", params, options })
        return {
          url: "https://connect.stripe.com/setup/e/abc",
          expires_at: 1_780_000_000,
        }
      },
    },
    webhooks: {
      constructEvent() {
        throw new Error("not used")
      },
    },
    ...overrides,
  }

  return { client, calls }
}

function adapter(client: StripeClientLike) {
  return new RealStripe({
    secretKey: "sk_test_unused",
    webhookSecret: FAKE_WEBHOOK_SECRET,
    client,
  })
}

describe("RealStripe account calls", () => {
  it("creates an Express account for a UK vendor with a payments and transfers request", async () => {
    const { client, calls } = stubClient()
    const account = await adapter(client).createConnectAccount(
      { vendorId: "vendor-1", email: "owner@example.com" },
      { idempotencyKey: "onboard:vendor-1" }
    )

    expect(calls[0]).toEqual({
      method: "accounts.create",
      params: {
        type: "express",
        country: "GB",
        email: "owner@example.com",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { vendorId: "vendor-1" },
      },
      options: { idempotencyKey: "onboard:vendor-1" },
    })
    expect(account).toEqual({
      id: "acct_123",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      currentlyDue: ["external_account"],
      pastDue: [],
      disabledReason: "requirements.past_due",
    })
  })

  it("omits the email and the idempotency options when not given", async () => {
    const { client, calls } = stubClient()

    await adapter(client).createConnectAccount({ vendorId: "vendor-1" })

    expect(calls[0]?.params).not.toHaveProperty("email")
    expect(calls[0]?.options).toBeUndefined()
  })

  it("creates an onboarding link and converts the expiry to a Date", async () => {
    const { client, calls } = stubClient()
    const link = await adapter(client).createAccountLink(
      {
        accountId: "acct_123",
        refreshUrl: "https://vml.test/refresh",
        returnUrl: "https://vml.test/return",
      },
      { idempotencyKey: "link-1" }
    )

    expect(calls[0]).toEqual({
      method: "accountLinks.create",
      params: {
        account: "acct_123",
        refresh_url: "https://vml.test/refresh",
        return_url: "https://vml.test/return",
        type: "account_onboarding",
      },
      options: { idempotencyKey: "link-1" },
    })
    expect(link.url).toBe("https://connect.stripe.com/setup/e/abc")
    expect(link.expiresAt.getTime()).toBe(1_780_000_000 * 1000)
  })

  it("TC-E4S2-03: capabilities are read as given, never inferred from details_submitted", () => {
    expect(
      mapAccount({
        id: "a",
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
      })
    ).toMatchObject({
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
      currentlyDue: [],
      pastDue: [],
      disabledReason: null,
    })
  })

  it("TC-E4S2-03: submitting details does not enable charges or payouts", () => {
    const account = mapAccount({
      id: "a",
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
    })

    expect(account.chargesEnabled).toBe(false)
    expect(account.payoutsEnabled).toBe(false)
    expect(account.detailsSubmitted).toBe(true)
  })

  it("maps a missing account to a typed error", async () => {
    const { client } = stubClient({
      accounts: {
        create: async () => {
          throw new Error("unused")
        },
        retrieve: async () => {
          throw Object.assign(new Error("No such account"), {
            code: "resource_missing",
          })
        },
      },
    })

    await expect(
      adapter(client).retrieveConnectAccount("acct_gone")
    ).rejects.toBeInstanceOf(StripeAccountNotFoundError)
  })

  it("maps an idempotency conflict to a typed error", async () => {
    const { client } = stubClient({
      accounts: {
        retrieve: async () => {
          throw new Error("unused")
        },
        create: async () => {
          throw Object.assign(new Error("Keys for idempotent requests"), {
            type: "idempotency_error",
          })
        },
      },
    })

    await expect(
      adapter(client).createConnectAccount(
        { vendorId: "v" },
        { idempotencyKey: "k" }
      )
    ).rejects.toBeInstanceOf(StripeIdempotencyError)
  })

  it("lets unexpected Stripe errors through unchanged", async () => {
    const boom = new Error("network down")
    const { client } = stubClient({
      accounts: {
        retrieve: async () => {
          throw new Error("unused")
        },
        create: async () => {
          throw boom
        },
      },
    })

    await expect(
      adapter(client).createConnectAccount({ vendorId: "v" })
    ).rejects.toBe(boom)
  })
})

/**
 * These use the real SDK's verifier (offline: no request is made) so the
 * adapter is proven against Stripe's own signature scheme, and the fake's
 * `signPayload` is proven to produce what Stripe would accept.
 */
describe("RealStripe webhook verification with the real SDK", () => {
  const secret = "whsec_test_secret_for_unit_tests"
  const real = new RealStripe({
    secretKey: "sk_test_unused",
    webhookSecret: secret,
  })
  const body = JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "account.updated",
    created: 1_780_000_000,
    data: { object: { id: "acct_1" } },
  })

  it("TC-E2S3-06: accepts a body signed by the SDK's own helper", () => {
    const header = Stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret,
    })
    const event = real.constructWebhookEvent(body, header)

    expect(event).toEqual({
      id: "evt_1",
      type: "account.updated",
      created: 1_780_000_000,
      data: { object: { id: "acct_1" } },
    })
  })

  it("the fake's signing scheme is accepted by the real verifier", () => {
    expect(real.constructWebhookEvent(body, signPayload(body, secret)).id).toBe(
      "evt_1"
    )
  })

  it("TC-E2S3-06: rejects a wrong secret, a changed body and a missing header", () => {
    const header = signPayload(body, secret)

    expect(() =>
      real.constructWebhookEvent(body, signPayload(body, "whsec_wrong"))
    ).toThrow(StripeSignatureError)
    expect(() =>
      real.constructWebhookEvent(body.replace("acct_1", "acct_2"), header)
    ).toThrow(StripeSignatureError)
    expect(() => real.constructWebhookEvent(body, null)).toThrow(
      StripeSignatureError
    )
  })

  it("rejects a replayed old signature", () => {
    const old = Math.floor(Date.now() / 1000) - 3600

    expect(() =>
      real.constructWebhookEvent(body, signPayload(body, secret, old))
    ).toThrow(StripeSignatureError)
  })

  it("does not leak the SDK's message", () => {
    try {
      real.constructWebhookEvent(body, signPayload(body, "whsec_wrong"))
    } catch (error) {
      expect((error as Error).message).toBe("Invalid Stripe webhook signature")
    }
  })
})
