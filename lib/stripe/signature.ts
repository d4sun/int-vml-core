import { createHmac, timingSafeEqual } from "node:crypto"
import { StripeSignatureError, WEBHOOK_TOLERANCE_SECONDS } from "./adapter"

/**
 * Stripe's webhook signature scheme: `Stripe-Signature: t=<unix>,v1=<hex>`
 * where `v1` is HMAC-SHA256 of `<t>.<raw body>` keyed with the endpoint
 * secret. The fake adapter uses this to verify; tests use `signPayload` to
 * produce valid and tampered requests. The real adapter delegates to the SDK.
 */
export function signPayload(
  rawBody: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000)
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")

  return `t=${timestamp},v1=${digest}`
}

export function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
  now: number = Math.floor(Date.now() / 1000)
): void {
  if (!header) throw new StripeSignatureError("Missing Stripe-Signature")

  let timestamp: number | undefined
  const candidates: string[] = []

  for (const part of header.split(",")) {
    const [key, value] = part.split("=")

    if (key === "t" && value) timestamp = Number(value)
    if (key === "v1" && value) candidates.push(value)
  }

  if (timestamp === undefined || !Number.isInteger(timestamp)) {
    throw new StripeSignatureError("Malformed Stripe-Signature")
  }

  if (candidates.length === 0) {
    throw new StripeSignatureError("Malformed Stripe-Signature")
  }

  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
  )

  const matches = candidates.some((candidate) => {
    const actual = Buffer.from(candidate)

    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    )
  })

  if (!matches) throw new StripeSignatureError()

  if (Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new StripeSignatureError(
      "Stripe-Signature timestamp out of tolerance"
    )
  }
}
