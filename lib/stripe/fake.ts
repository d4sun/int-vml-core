import { randomUUID } from "node:crypto"
import {
  type CheckoutSession,
  type CreateCheckoutSessionInput,
  type CreatePaymentIntentInput,
  type CreateTransferInput,
  type PaymentIntent,
  type Transfer,
  type CreateRefundInput,
  type CreateTransferReversalInput,
  type Refund,
  type TransferReversal,
  StripeAccountNotFoundError,
  StripeIdempotencyError,
  type AccountLink,
  type ConnectAccount,
  type CreateAccountLinkInput,
  type CreateConnectAccountInput,
  type RequestOptions,
  type StripeAdapter,
  type StripeWebhookEvent,
} from "./adapter"
import { signPayload, verifySignature } from "./signature"

export const FAKE_WEBHOOK_SECRET = "whsec_fake_for_development_only"

const REQUIREMENTS_WHEN_NEW = ["external_account", "individual.verification"]

export type FakeStripeOptions = {
  webhookSecret?: string
  now?: () => Date
  /** Account link lifetime; Stripe's real links are short-lived. */
  linkTtlMs?: number
}

type Stored<T> = { fingerprint: string; value: T }

/**
 * In-memory Stripe for tests and local development. It enforces the parts of
 * the contract the app relies on: idempotent creates, verified webhooks and
 * the `charges_enabled && payouts_enabled` readiness rules. It never contacts
 * the network.
 *
 * Test controls (`completeOnboarding`, `setAccount`, `signedEvent`) are extra
 * methods that do not exist on the interface, so production code cannot use
 * them.
 */
export class FakeStripe implements StripeAdapter {
  readonly webhookSecret: string
  private readonly now: () => Date
  private readonly linkTtlMs: number
  private readonly accounts = new Map<string, ConnectAccount>()
  private readonly accountKeys = new Map<string, Stored<ConnectAccount>>()
  private readonly linkKeys = new Map<string, Stored<AccountLink>>()
  private readonly paymentKeys = new Map<string, Stored<PaymentIntent>>()
  private readonly transferKeys = new Map<string, Stored<Transfer>>()
  private readonly refundKeys = new Map<string, Stored<Refund>>()
  private readonly reversalKeys = new Map<string, Stored<TransferReversal>>()

  /** Test control: when true, every refund is declined (E10-S1-02 failure path). */
  failRefunds = false
  /** Test control: when true, every transfer reversal is declined. */
  failReversals = false

  /** Every call made through the interface, for assertions. */
  readonly calls: {
    method: string
    input: unknown
    options?: RequestOptions
  }[] = []

  constructor(options: FakeStripeOptions = {}) {
    this.webhookSecret = options.webhookSecret ?? FAKE_WEBHOOK_SECRET
    this.now = options.now ?? (() => new Date())
    this.linkTtlMs = options.linkTtlMs ?? 5 * 60 * 1000
  }

  async createConnectAccount(
    input: CreateConnectAccountInput,
    options: RequestOptions = {}
  ): Promise<ConnectAccount> {
    this.calls.push({ method: "createConnectAccount", input, options })

    const replay = this.replay(this.accountKeys, options, input)

    if (replay) return { ...replay }

    const account: ConnectAccount = {
      id: `acct_fake_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      currentlyDue: [...REQUIREMENTS_WHEN_NEW],
      pastDue: [],
      disabledReason: "requirements.past_due",
    }

    this.accounts.set(account.id, account)
    this.remember(this.accountKeys, options, input, account)

    return { ...account }
  }

  async retrieveConnectAccount(accountId: string): Promise<ConnectAccount> {
    this.calls.push({ method: "retrieveConnectAccount", input: { accountId } })

    return { ...this.require(accountId) }
  }

  async createAccountLink(
    input: CreateAccountLinkInput,
    options: RequestOptions = {}
  ): Promise<AccountLink> {
    this.calls.push({ method: "createAccountLink", input, options })

    this.require(input.accountId)

    const replay = this.replay(this.linkKeys, options, input)

    if (replay) return { ...replay }

    // The "hosted" page is a dev-only route of this app, so a local run and
    // the e2e tests can walk the whole flow (see `lib/stripe/fake-onboarding.ts`).
    const page = new URL("/api/dev/stripe-fake/onboard", input.returnUrl)

    page.searchParams.set("account", input.accountId)
    page.searchParams.set("return", input.returnUrl)
    page.searchParams.set("refresh", input.refreshUrl)

    const link: AccountLink = {
      url: page.toString(),
      expiresAt: new Date(this.now().getTime() + this.linkTtlMs),
    }

    this.remember(this.linkKeys, options, input, link)

    return { ...link }
  }

  /** Test control: transfers to these accounts fail, as a declined payout would. */
  failTransfersTo = new Set<string>()

  /** Test controls: the checkout sessions this fake has created, by id. */
  readonly checkoutSessions = new Map<
    string,
    {
      bookingId: string
      amount: number
      paymentIntentId: string
      successUrl: string
      cancelUrl: string
    }
  >()
  private readonly checkoutKeys = new Map<string, Stored<CheckoutSession>>()

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
    options: RequestOptions = {}
  ): Promise<CheckoutSession> {
    this.calls.push({ method: "createCheckoutSession", input, options })

    const replay = this.replay(this.checkoutKeys, options, input)

    if (replay) return { ...replay }

    const id = `cs_fake_${randomUUID().replaceAll("-", "").slice(0, 16)}`
    const origin = new URL(input.successUrl).origin
    const session: CheckoutSession = {
      id,
      // The fake's hosted page: a dev-only route of this app.
      url: `${origin}/api/dev/stripe-fake/checkout?session=${id}`,
    }

    this.checkoutSessions.set(id, {
      bookingId: input.bookingId,
      amount: input.amount,
      paymentIntentId: `pi_fake_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    })
    this.remember(this.checkoutKeys, options, input, session)

    return { ...session }
  }

  /** The signed `payment_intent.succeeded` event for a checkout session the visitor paid. */
  paidEventFor(sessionId: string): {
    rawBody: string
    signature: string
    event: StripeWebhookEvent
  } {
    const session = this.checkoutSessions.get(sessionId)

    if (!session) throw new StripeAccountNotFoundError(sessionId)

    return this.signedEvent({
      id: `evt_fake_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      type: "payment_intent.succeeded",
      created: Math.floor(this.now().getTime() / 1000),
      data: {
        object: {
          id: session.paymentIntentId,
          amount: session.amount,
          metadata: { bookingId: session.bookingId },
        },
      },
    })
  }

  async createTransfer(
    input: CreateTransferInput,
    options: RequestOptions = {}
  ): Promise<Transfer> {
    this.calls.push({ method: "createTransfer", input, options })

    if (this.failTransfersTo.has(input.destinationAccountId)) {
      throw new Error(`transfer to ${input.destinationAccountId} was declined`)
    }

    const replay = this.replay(this.transferKeys, options, input)

    if (replay) return { ...replay }

    const transfer: Transfer = {
      id: `tr_fake_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      amount: input.amount,
      status: "created",
    }

    this.remember(this.transferKeys, options, input, transfer)

    return { ...transfer }
  }

  async createRefund(
    input: CreateRefundInput,
    options: RequestOptions = {}
  ): Promise<Refund> {
    this.calls.push({ method: "createRefund", input, options })

    if (this.failRefunds) throw new Error("refund was declined")

    const replay = this.replay(this.refundKeys, options, input)

    if (replay) return { ...replay }

    const refund: Refund = {
      id: `re_fake_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      amount: input.amount,
      status: "succeeded",
    }

    this.remember(this.refundKeys, options, input, refund)

    return { ...refund }
  }

  async reverseTransfer(
    input: CreateTransferReversalInput,
    options: RequestOptions = {}
  ): Promise<TransferReversal> {
    this.calls.push({ method: "reverseTransfer", input, options })

    if (this.failReversals) throw new Error("transfer reversal was declined")

    const replay = this.replay(this.reversalKeys, options, input)

    if (replay) return { ...replay }

    const reversal: TransferReversal = {
      id: `trr_fake_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      amount: input.amount,
    }

    this.remember(this.reversalKeys, options, input, reversal)

    return { ...reversal }
  }

  async createPaymentIntent(
    input: CreatePaymentIntentInput,
    options: RequestOptions = {}
  ): Promise<PaymentIntent> {
    this.calls.push({ method: "createPaymentIntent", input, options })

    const replay = this.replay(this.paymentKeys, options, input)

    if (replay) return { ...replay }

    const intent: PaymentIntent = {
      id: `pi_fake_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      clientSecret: null,
      amount: input.amount,
      status: "requires_payment_method",
    }

    this.remember(this.paymentKeys, options, input, intent)

    return { ...intent }
  }

  constructWebhookEvent(
    rawBody: string,
    signatureHeader: string | null
  ): StripeWebhookEvent {
    verifySignature(
      rawBody,
      signatureHeader,
      this.webhookSecret,
      Math.floor(this.now().getTime() / 1000)
    )

    return JSON.parse(rawBody) as StripeWebhookEvent
  }

  // ---- test controls ------------------------------------------------------

  /** Overwrites an account's state, as Stripe would after the owner acts. */
  setAccount(
    accountId: string,
    patch: Partial<Omit<ConnectAccount, "id">>
  ): ConnectAccount {
    const next = { ...this.require(accountId), ...patch }

    this.accounts.set(accountId, next)

    return { ...next }
  }

  /** The owner finishes KYC and bank setup: both capabilities switch on. */
  completeOnboarding(accountId: string): ConnectAccount {
    return this.setAccount(accountId, {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      currentlyDue: [],
      pastDue: [],
      disabledReason: null,
    })
  }

  /** An `account.updated` event for the account's current state, signed. */
  signedAccountUpdated(
    accountId: string,
    eventId: string = `evt_fake_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    /** Seconds since the epoch; defaults to the fake's clock. */
    created: number = Math.floor(this.now().getTime() / 1000)
  ): { rawBody: string; signature: string; event: StripeWebhookEvent } {
    const account = this.require(accountId)

    return this.signedEvent({
      id: eventId,
      type: "account.updated",
      created,
      data: {
        object: {
          id: account.id,
          object: "account",
          charges_enabled: account.chargesEnabled,
          payouts_enabled: account.payoutsEnabled,
          details_submitted: account.detailsSubmitted,
          requirements: {
            currently_due: account.currentlyDue,
            past_due: account.pastDue,
            disabled_reason: account.disabledReason,
          },
        },
      },
    })
  }

  signedEvent(event: StripeWebhookEvent): {
    rawBody: string
    signature: string
    event: StripeWebhookEvent
  } {
    const rawBody = JSON.stringify(event)

    return {
      rawBody,
      signature: signPayload(
        rawBody,
        this.webhookSecret,
        Math.floor(this.now().getTime() / 1000)
      ),
      event,
    }
  }

  // ---- internals ----------------------------------------------------------

  private require(accountId: string): ConnectAccount {
    const account = this.accounts.get(accountId)

    if (!account) throw new StripeAccountNotFoundError(accountId)

    return account
  }

  private replay<T>(
    store: Map<string, Stored<T>>,
    options: RequestOptions,
    input: unknown
  ): T | undefined {
    if (!options.idempotencyKey) return undefined

    const stored = store.get(options.idempotencyKey)

    if (!stored) return undefined

    if (stored.fingerprint !== JSON.stringify(input)) {
      throw new StripeIdempotencyError()
    }

    return stored.value
  }

  private remember<T>(
    store: Map<string, Stored<T>>,
    options: RequestOptions,
    input: unknown,
    value: T
  ): void {
    if (!options.idempotencyKey) return

    store.set(options.idempotencyKey, {
      fingerprint: JSON.stringify(input),
      value,
    })
  }
}
