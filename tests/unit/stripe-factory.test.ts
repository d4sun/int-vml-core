import { describe, expect, it } from "vitest"
import { FakeStripe } from "@/lib/stripe/fake"
import { createStripeAdapter } from "@/lib/stripe"
import { RealStripe } from "@/lib/stripe/real"

describe("createStripeAdapter", () => {
  it("uses the real adapter when a key and webhook secret are set", () => {
    const { adapter, mode } = createStripeAdapter({
      NODE_ENV: "production",
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
    })

    expect(mode).toBe("real")
    expect(adapter).toBeInstanceOf(RealStripe)
  })

  it("refuses a key without a webhook secret", () => {
    expect(() =>
      createStripeAdapter({
        NODE_ENV: "development",
        STRIPE_SECRET_KEY: "sk_test_x",
      })
    ).toThrow("STRIPE_WEBHOOK_SECRET")
  })

  it("falls back to the fake outside production", () => {
    for (const NODE_ENV of ["development", "test"]) {
      const { adapter, mode } = createStripeAdapter({ NODE_ENV })

      expect(mode).toBe("fake")
      expect(adapter).toBeInstanceOf(FakeStripe)
    }
  })

  it("never falls back to the fake in production", () => {
    expect(() => createStripeAdapter({ NODE_ENV: "production" })).toThrow(
      "STRIPE_SECRET_KEY"
    )
  })

  it("lets the fake use a configured webhook secret", () => {
    const { adapter } = createStripeAdapter({
      NODE_ENV: "test",
      STRIPE_WEBHOOK_SECRET: "whsec_from_env",
    })

    expect((adapter as FakeStripe).webhookSecret).toBe("whsec_from_env")
  })
  it("an explicit STRIPE_ADAPTER=fake gives the fake even in a production build, with its own secret", () => {
    const { adapter, mode } = createStripeAdapter({
      NODE_ENV: "production",
      STRIPE_ADAPTER: "fake",
      STRIPE_WEBHOOK_SECRET: "whsec_private_to_this_run",
    })

    expect(mode).toBe("fake")
    expect((adapter as FakeStripe).webhookSecret).toBe(
      "whsec_private_to_this_run"
    )
  })

  it("the fake in production without its own webhook secret is refused, so the public secret is never accepted there", () => {
    expect(() =>
      createStripeAdapter({ NODE_ENV: "production", STRIPE_ADAPTER: "fake" })
    ).toThrow("STRIPE_WEBHOOK_SECRET")
  })

  it("the fake cannot be combined with a real key", () => {
    expect(() =>
      createStripeAdapter({
        NODE_ENV: "development",
        STRIPE_ADAPTER: "fake",
        STRIPE_SECRET_KEY: "sk_test_x",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
      })
    ).toThrow("cannot be combined")
  })
})
