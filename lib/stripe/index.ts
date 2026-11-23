import { getEnv } from "../env"
import type { StripeAdapter } from "./adapter"
import { FakeStripe } from "./fake"
import { RealStripe } from "./real"

export type StripeEnv = Record<string, string | undefined>

export type StripeSelection = {
  adapter: StripeAdapter
  mode: "real" | "fake"
}

/**
 * Chooses the adapter once, at first use:
 *
 * - `STRIPE_SECRET_KEY` present → the real SDK (needs `STRIPE_WEBHOOK_SECRET`).
 * - no key in production → hard failure; a fake in production would mint
 *   accounts that do not exist and accept webhooks signed with a public secret.
 * - no key elsewhere → the in-memory fake, for dev and tests.
 */
export function createStripeAdapter(
  env: StripeEnv = getEnv()
): StripeSelection {
  if (env.STRIPE_SECRET_KEY) {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new Error(
        "STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set"
      )
    }

    return {
      mode: "real",
      adapter: new RealStripe({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      }),
    }
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "No Stripe configuration: set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET"
    )
  }

  return {
    mode: "fake",
    adapter: new FakeStripe({
      ...(env.STRIPE_WEBHOOK_SECRET
        ? { webhookSecret: env.STRIPE_WEBHOOK_SECRET }
        : {}),
    }),
  }
}

const globalForStripe = globalThis as unknown as {
  vmlStripe?: StripeSelection
}

/**
 * The process-wide adapter. Memoised on `globalThis` so the fake keeps its
 * accounts across dev-server module reloads.
 */
export function getStripe(): StripeAdapter {
  globalForStripe.vmlStripe ??= createStripeAdapter()

  return globalForStripe.vmlStripe.adapter
}
