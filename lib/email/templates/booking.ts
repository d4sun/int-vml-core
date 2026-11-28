import { renderLayout, type TemplateContent } from "./layout"

export type BookingEmailLine = { title: string; when: string; places: number }

export type BookingConfirmedEmailInput = {
  name?: string | null
  bookingRef: string
  /** Formatted total, for example "£25.00". */
  total: string
  lines: BookingEmailLine[]
  bookingsUrl: string
}

export type NewBookingEmailInput = {
  name?: string | null
  vendorName: string
  bookingRef: string
  lines: BookingEmailLine[]
  dashboardUrl: string
}

const FOOTER = "Visit My London — an independent London travel guide."

function greeting(name?: string | null): string {
  const trimmed = name?.trim()

  return trimmed ? `Hi ${trimmed},` : "Hi there,"
}

function lineText(line: BookingEmailLine): string {
  return `${line.places} × ${line.title}, ${line.when}`
}

/** Sent to the visitor once their payment is confirmed. */
export function bookingConfirmedEmail(
  input: BookingConfirmedEmailInput
): TemplateContent {
  const subject = `Your booking ${input.bookingRef} is confirmed`
  const { html, text } = renderLayout({
    heading: "Your booking is confirmed",
    preview: `Booking ${input.bookingRef} is confirmed. Total ${input.total}.`,
    paragraphs: [
      greeting(input.name),
      `Booking reference: ${input.bookingRef}. Total paid: ${input.total}.`,
      ...input.lines.map(lineText),
      "You can see your bookings any time in your account.",
    ],
    action: { label: "View your bookings", url: input.bookingsUrl },
    footer: FOOTER,
  })

  return { subject, html, text }
}

/** Sent to each vendor owner when one of their places is booked. */
export function newBookingEmail(input: NewBookingEmailInput): TemplateContent {
  const subject = `New booking for ${input.vendorName}: ${input.bookingRef}`
  const { html, text } = renderLayout({
    heading: "You have a new booking",
    preview: `Booking ${input.bookingRef} for ${input.vendorName}.`,
    paragraphs: [
      greeting(input.name),
      `Booking reference: ${input.bookingRef}, for ${input.vendorName}.`,
      ...input.lines.map(lineText),
    ],
    action: { label: "Open your dashboard", url: input.dashboardUrl },
    footer: FOOTER,
  })

  return { subject, html, text }
}
