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
 *   The only exception is an explicit `STRIPE_ADAPTER=fake` with its own
 *   `STRIPE_WEBHOOK_SECRET`, which the e2e suite sets to run a production build.
 * - no key elsewhere → the in-memory fake, for dev and tests.
 */
export function createStripeAdapter(
  env: StripeEnv = getEnv()
): StripeSelection {
  if (env.STRIPE_SECRET_KEY && env.STRIPE_ADAPTER === "fake") {
    throw new Error(
      "STRIPE_ADAPTER=fake cannot be combined with STRIPE_SECRET_KEY"
    )
  }

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

  if (env.STRIPE_ADAPTER === "fake") {
    // The one way to run the fake in a production build (the e2e suite does).
    // Without a private webhook secret the fake would accept events signed
    // with a public one, so that is refused.
    if (env.NODE_ENV === "production" && !env.STRIPE_WEBHOOK_SECRET) {
      throw new Error(
        "STRIPE_ADAPTER=fake in production needs its own STRIPE_WEBHOOK_SECRET"
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

/**
 * The in-memory fake, or `null` when the real adapter is in use. Decided by
 * the mode recorded at selection, not by `instanceof`: Next bundles server
 * code per route, so the same class can exist twice and `instanceof` lies.
 * Only the dev-only fake onboarding page uses this.
 */
export function getFakeStripe(): FakeStripe | null {
  getStripe()

  const selection = globalForStripe.vmlStripe

  return selection?.mode === "fake" ? (selection.adapter as FakeStripe) : null
}
