/**
 * The only way the app talks to Stripe (CR-4). Services depend on this
 * interface, never on the SDK, so unit and integration tests run against
 * `fake.ts` and production runs `real.ts` with the same contract.
 *
 * The interface carries only what the app needs today (Connect Express
 * onboarding and webhook verification). Payment intents, transfers, refunds
 * and reversals are added with the checkout and refund stories that use them.
 *
 * Server-only: never import this from a client component.
 */

export type ConnectAccount = {
  id: string
  chargesEnabled: boolean
  payoutsEnabled: boolean
  /** The owner has submitted everything Stripe asked for so far. */
  detailsSubmitted: boolean
  /** Fields Stripe still needs now, e.g. `external_account`. */
  currentlyDue: string[]
  /** Fields whose deadline has passed. */
  pastDue: string[]
  /** Why the account is restricted, e.g. `requirements.past_due`. */
  disabledReason: string | null
}

export type CreateConnectAccountInput = {
  /** Our vendor id, stored as Stripe metadata so an account can be traced back. */
  vendorId: string
  email?: string
}

export type CreateAccountLinkInput = {
  accountId: string
  /** Where Stripe sends the owner if the link expired or was already used. */
  refreshUrl: string
  /** Where Stripe sends the owner when they leave the hosted flow. */
  returnUrl: string
}

export type AccountLink = {
  url: string
  expiresAt: Date
}

/**
 * Stripe replays the stored response for a repeated key, so a retry after a
 * timeout never creates a second account. Reusing a key with different
 * parameters is an error.
 */
export type RequestOptions = {
  idempotencyKey?: string
}

/** A verified webhook event. `data.object` is Stripe's payload, unparsed. */
export type StripeWebhookEvent = {
  id: string
  type: string
  /** Seconds since the epoch, as Stripe sends it. */
  created: number
  data: { object: unknown }
}

export interface StripeAdapter {
  createConnectAccount(
    input: CreateConnectAccountInput,
    options?: RequestOptions
  ): Promise<ConnectAccount>

  retrieveConnectAccount(accountId: string): Promise<ConnectAccount>

  createAccountLink(
    input: CreateAccountLinkInput,
    options?: RequestOptions
  ): Promise<AccountLink>

  /**
   * Verifies the signature over the **raw** request body and returns the
   * event. Throws `StripeSignatureError` for a missing, malformed, stale or
   * wrong signature; the body is never parsed before it is verified.
   */
  constructWebhookEvent(
    rawBody: string,
    signatureHeader: string | null
  ): StripeWebhookEvent
}

/** The webhook could not be verified. Callers answer 400 and do nothing else. */
export class StripeSignatureError extends Error {
  constructor(message = "Invalid Stripe webhook signature") {
    super(message)
    this.name = "StripeSignatureError"
  }
}

/** The same idempotency key was reused with different parameters. */
export class StripeIdempotencyError extends Error {
  constructor(message = "Idempotency key reused with different parameters") {
    super(message)
    this.name = "StripeIdempotencyError"
  }
}

/** A Stripe account that does not exist (or is not ours). */
export class StripeAccountNotFoundError extends Error {
  constructor(accountId: string) {
    super(`No such Stripe account: ${accountId}`)
    this.name = "StripeAccountNotFoundError"
  }
}

/** Stripe rejects timestamps further than this from now (seconds). */
export const WEBHOOK_TOLERANCE_SECONDS = 300

const hasName = (error: unknown, name: string) =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === name

/**
 * Name-based on purpose: Next.js bundles server code per route, so the same
 * error class can exist twice and `instanceof` would miss an error thrown by
 * an adapter that another bundle created.
 */
export const isStripeSignatureError = (error: unknown) =>
  hasName(error, "StripeSignatureError")

export const isStripeAccountNotFoundError = (error: unknown) =>
  hasName(error, "StripeAccountNotFoundError")
