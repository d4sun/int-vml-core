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

/**
 * A card payment for a booking, in pence and GBP. Either a destination charge
 * (single vendor): the vendor is paid the amount less `applicationFeeAmount`
 * (the platform's commission); or a platform charge (several vendors): the
 * money is held by the platform and split by transfers on confirmation.
 */
/** A transfer of part of a payment to one vendor's connected account (pence). */
export type CreateTransferInput = {
  amount: number
  destinationAccountId: string
  transferGroup: string
  /** Our transfer id, stored as metadata so a Stripe transfer traces back to it. */
  transferId: string
}

export type Transfer = { id: string; amount: number; status: string }

export type CreateRefundInput = {
  /** The intent the visitor paid. */
  paymentIntentId: string
  amount: number
  /** Our refund id, kept as metadata and as the idempotency key's owner. */
  refundId: string
  /**
   * True for a destination charge: Stripe takes the sale back from the vendor
   * in the same call. False for a platform charge, where the platform sends
   * its own transfer reversal separately.
   */
  reverseTransfer: boolean
}

export type Refund = { id: string; amount: number; status: string }

export type CreateTransferReversalInput = {
  /** The Stripe transfer id (`tr_…`) that was sent to the vendor. */
  transferId: string
  amount: number
  refundId: string
}

export type TransferReversal = { id: string; amount: number }

export type CreatePaymentIntentInput = {
  amount: number
  /** Our booking id, stored as metadata so a payment traces back to it. */
  bookingId: string
  /** Set for a destination charge only. */
  destinationAccountId?: string
  /** Set for a destination charge only: the platform's commission, in pence. */
  applicationFeeAmount?: number
  /** Set for a platform charge: groups the later transfers with this payment. */
  transferGroup?: string
}

/**
 * A hosted Stripe Checkout page for one booking. Stripe takes the card and
 * creates the payment intent; the charge and transfer params are passed on to it.
 */
export type CreateCheckoutSessionInput = {
  amount: number
  bookingId: string
  /** Shown to the visitor on the Stripe page. */
  description: string
  successUrl: string
  cancelUrl: string
  destinationAccountId?: string
  applicationFeeAmount?: number
  transferGroup?: string
}

export type CheckoutSession = { id: string; url: string }

export type PaymentIntent = {
  id: string
  clientSecret: string | null
  amount: number
  status: string
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

  /**
   * Creates a payment for a booking. The same idempotency key always returns
   * the first intent, so a repeated submit cannot charge twice (CR-4 / E2-S2-03).
   */
  createPaymentIntent(
    input: CreatePaymentIntentInput,
    options?: RequestOptions
  ): Promise<PaymentIntent>

  /** A hosted checkout page for a booking. Same key, same session. */
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
    options?: RequestOptions
  ): Promise<CheckoutSession>

  /** Sends a vendor's share of a platform charge. Same key, same transfer. */
  createTransfer(
    input: CreateTransferInput,
    options?: RequestOptions
  ): Promise<Transfer>

  /** Refunds part or all of a paid intent. Same key, same refund (E10-S1-02). */
  createRefund(
    input: CreateRefundInput,
    options?: RequestOptions
  ): Promise<Refund>

  /** Takes money back from a vendor's transfer. Same key, same reversal. */
  reverseTransfer(
    input: CreateTransferReversalInput,
    options?: RequestOptions
  ): Promise<TransferReversal>
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
