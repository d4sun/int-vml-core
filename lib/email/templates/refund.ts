import { renderLayout, type TemplateContent } from "./layout"

export type RefundIssuedEmailInput = {
  name?: string | null
  bookingRef: string
  /** Formatted amount refunded, for example "£4.00". */
  amount: string
  bookingsUrl: string
}

export type RefundReversalEmailInput = {
  name?: string | null
  vendorName: string
  bookingRef: string
  /** Formatted amount refunded from the booking, for example "£4.00". */
  amount: string
  dashboardUrl: string
}

const FOOTER = "Visit My London — an independent London travel guide."

function greeting(name?: string | null): string {
  const trimmed = name?.trim()

  return trimmed ? `Hi ${trimmed},` : "Hi there,"
}

/** Sent to the visitor once a refund has gone through (E10-S1-06). */
export function refundIssuedEmail(
  input: RefundIssuedEmailInput
): TemplateContent {
  const subject = `Refund for booking ${input.bookingRef}`
  const { html, text } = renderLayout({
    heading: "Your refund has been issued",
    preview: `${input.amount} refunded for booking ${input.bookingRef}.`,
    paragraphs: [
      greeting(input.name),
      `We have refunded ${input.amount} for booking ${input.bookingRef}. It can take a few days to reach your account, depending on your bank.`,
      "You can see your bookings any time in your account.",
    ],
    action: { label: "View your bookings", url: input.bookingsUrl },
    footer: FOOTER,
  })

  return { subject, html, text }
}

/** Sent to each vendor owner when part of their booking is refunded and taken back (E10-S1-06). */
export function refundReversalEmail(
  input: RefundReversalEmailInput
): TemplateContent {
  const subject = `Refund on booking ${input.bookingRef} for ${input.vendorName}`
  const { html, text } = renderLayout({
    heading: "A booking was refunded",
    preview: `${input.amount} of booking ${input.bookingRef} was refunded.`,
    paragraphs: [
      greeting(input.name),
      `${input.amount} of booking ${input.bookingRef} for ${input.vendorName} was refunded to the visitor, and your share of it has been taken back from your payouts.`,
    ],
    action: { label: "Open your dashboard", url: input.dashboardUrl },
    footer: FOOTER,
  })

  return { subject, html, text }
}
