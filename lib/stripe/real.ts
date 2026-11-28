import Stripe from "stripe"
import {
  type CheckoutSession,
  type CreateCheckoutSessionInput,
  type CreatePaymentIntentInput,
  type CreateTransferInput,
  type PaymentIntent,
  type Transfer,
  StripeAccountNotFoundError,
  StripeIdempotencyError,
  StripeSignatureError,
  WEBHOOK_TOLERANCE_SECONDS,
  type AccountLink,
  type ConnectAccount,
  type CreateAccountLinkInput,
  type CreateConnectAccountInput,
  type RequestOptions,
  type StripeAdapter,
  type StripeWebhookEvent,
} from "./adapter"

type AccountPayload = {
  id: string
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
  requirements?: {
    currently_due?: string[] | null
    past_due?: string[] | null
    disabled_reason?: string | null
  } | null
}

/** The slice of the SDK this adapter uses, so tests can supply a stub. */
export type StripeClientLike = {
  accounts: {
    create(
      params: {
        type: "express"
        country: string
        email?: string
        capabilities: Record<string, { requested: boolean }>
        metadata: Record<string, string>
      },
      options?: { idempotencyKey?: string }
    ): Promise<AccountPayload>
    retrieve(accountId: string): Promise<AccountPayload>
  }
  accountLinks: {
    create(
      params: {
        account: string
        refresh_url: string
        return_url: string
        type: "account_onboarding"
      },
      options?: { idempotencyKey?: string }
    ): Promise<{ url: string; expires_at: number }>
  }
  checkout: {
    sessions: {
      create(
        params: {
          mode: "payment"
          line_items: {
            quantity: number
            price_data: {
              currency: string
              unit_amount: number
              product_data: { name: string }
            }
          }[]
          payment_intent_data: {
            metadata: Record<string, string>
            application_fee_amount?: number
            transfer_data?: { destination: string }
            transfer_group?: string
          }
          metadata: Record<string, string>
          success_url: string
          cancel_url: string
        },
        options?: { idempotencyKey?: string }
      ): Promise<{ id: string; url: string | null }>
    }
  }
  transfers: {
    create(
      params: {
        amount: number
        currency: string
        destination: string
        transfer_group: string
        metadata: Record<string, string>
      },
      options?: { idempotencyKey?: string }
    ): Promise<{ id: string; amount: number; object: string }>
  }
  paymentIntents: {
    create(
      params: {
        amount: number
        currency: string
        metadata: Record<string, string>
        transfer_data?: { destination: string }
        application_fee_amount?: number
        transfer_group?: string
      },
      options?: { idempotencyKey?: string }
    ): Promise<{
      id: string
      client_secret: string | null
      amount: number
      status: string
    }>
  }
  webhooks: {
    constructEvent(
      payload: string,
      header: string,
      secret: string,
      tolerance?: number
    ): StripeWebhookEvent
  }
}

export type RealStripeOptions = {
  secretKey: string
  webhookSecret: string
  /** Injected in tests; defaults to the SDK. */
  client?: StripeClientLike
}

/** Platform is UK-based; vendors are UK businesses paid out in GBP. */
const CONNECT_COUNTRY = "GB"

export function mapAccount(account: AccountPayload): ConnectAccount {
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
    currentlyDue: account.requirements?.currently_due ?? [],
    pastDue: account.requirements?.past_due ?? [],
    disabledReason: account.requirements?.disabled_reason ?? null,
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown }

    return typeof code === "string" ? code : undefined
  }

  return undefined
}

export class RealStripe implements StripeAdapter {
  private readonly client: StripeClientLike
  private readonly webhookSecret: string

  constructor(options: RealStripeOptions) {
    this.webhookSecret = options.webhookSecret
    this.client =
      options.client ??
      (new Stripe(options.secretKey, {
        maxNetworkRetries: 2,
        timeout: 15_000,
      }) as unknown as StripeClientLike)
  }

  async createConnectAccount(
    input: CreateConnectAccountInput,
    options: RequestOptions = {}
  ): Promise<ConnectAccount> {
    try {
      const account = await this.client.accounts.create(
        {
          type: "express",
          country: CONNECT_COUNTRY,
          ...(input.email ? { email: input.email } : {}),
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: { vendorId: input.vendorId },
        },
        options.idempotencyKey
          ? { idempotencyKey: options.idempotencyKey }
          : undefined
      )

      return mapAccount(account)
    } catch (error) {
      throw translate(error)
    }
  }

  async retrieveConnectAccount(accountId: string): Promise<ConnectAccount> {
    try {
      return mapAccount(await this.client.accounts.retrieve(accountId))
    } catch (error) {
      if (errorCode(error) === "resource_missing") {
        throw new StripeAccountNotFoundError(accountId)
      }

      throw translate(error)
    }
  }

  async createAccountLink(
    input: CreateAccountLinkInput,
    options: RequestOptions = {}
  ): Promise<AccountLink> {
    try {
      const link = await this.client.accountLinks.create(
        {
          account: input.accountId,
          refresh_url: input.refreshUrl,
          return_url: input.returnUrl,
          type: "account_onboarding",
        },
        options.idempotencyKey
          ? { idempotencyKey: options.idempotencyKey }
          : undefined
      )

      return { url: link.url, expiresAt: new Date(link.expires_at * 1000) }
    } catch (error) {
      if (errorCode(error) === "resource_missing") {
        throw new StripeAccountNotFoundError(input.accountId)
      }

      throw translate(error)
    }
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
    options: RequestOptions = {}
  ): Promise<CheckoutSession> {
    try {
      const session = await this.client.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "gbp",
                unit_amount: input.amount,
                product_data: { name: input.description },
              },
            },
          ],
          payment_intent_data: {
            metadata: { bookingId: input.bookingId },
            ...(input.applicationFeeAmount !== undefined
              ? { application_fee_amount: input.applicationFeeAmount }
              : {}),
            ...(input.destinationAccountId
              ? { transfer_data: { destination: input.destinationAccountId } }
              : {}),
            ...(input.transferGroup
              ? { transfer_group: input.transferGroup }
              : {}),
          },
          metadata: { bookingId: input.bookingId },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
        options.idempotencyKey
          ? { idempotencyKey: options.idempotencyKey }
          : undefined
      )

      if (!session.url) throw new Error("Stripe returned no checkout page")

      return { id: session.id, url: session.url }
    } catch (error) {
      throw translate(error)
    }
  }

  async createTransfer(
    input: CreateTransferInput,
    options: RequestOptions = {}
  ): Promise<Transfer> {
    try {
      const transfer = await this.client.transfers.create(
        {
          amount: input.amount,
          currency: "gbp",
          destination: input.destinationAccountId,
          transfer_group: input.transferGroup,
          metadata: { transferId: input.transferId },
        },
        options.idempotencyKey
          ? { idempotencyKey: options.idempotencyKey }
          : undefined
      )

      return { id: transfer.id, amount: transfer.amount, status: "created" }
    } catch (error) {
      throw translate(error)
    }
  }

  async createPaymentIntent(
    input: CreatePaymentIntentInput,
    options: RequestOptions = {}
  ): Promise<PaymentIntent> {
    try {
      const intent = await this.client.paymentIntents.create(
        {
          amount: input.amount,
          currency: "gbp",
          metadata: { bookingId: input.bookingId },
          ...(input.destinationAccountId
            ? { transfer_data: { destination: input.destinationAccountId } }
            : {}),
          ...(input.applicationFeeAmount !== undefined
            ? { application_fee_amount: input.applicationFeeAmount }
            : {}),
          ...(input.transferGroup
            ? { transfer_group: input.transferGroup }
            : {}),
        },
        options.idempotencyKey
          ? { idempotencyKey: options.idempotencyKey }
          : undefined
      )

      return {
        id: intent.id,
        clientSecret: intent.client_secret,
        amount: intent.amount,
        status: intent.status,
      }
    } catch (error) {
      throw translate(error)
    }
  }

  constructWebhookEvent(
    rawBody: string,
    signatureHeader: string | null
  ): StripeWebhookEvent {
    if (!signatureHeader)
      throw new StripeSignatureError("Missing Stripe-Signature")

    try {
      const event = this.client.webhooks.constructEvent(
        rawBody,
        signatureHeader,
        this.webhookSecret,
        WEBHOOK_TOLERANCE_SECONDS
      )

      return {
        id: event.id,
        type: event.type,
        created: event.created,
        data: { object: event.data.object },
      }
    } catch {
      // The SDK's message can describe the secret mismatch; callers get none.
      throw new StripeSignatureError()
    }
  }
}

function translate(error: unknown): unknown {
  if (errorCode(error) === "idempotency_key_in_use") {
    return new StripeIdempotencyError()
  }

  if (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === "idempotency_error"
  ) {
    return new StripeIdempotencyError()
  }

  return error
}
