import { renderLayout, type TemplateContent } from "./layout"

export type VendorStatusEmailInput = {
  /** The recipient's name; falls back to a neutral greeting. */
  name?: string | null
  vendorName: string
  /** The admin's reason, shown for a rejection and a suspension. */
  reason?: string
  /** Where "open your dashboard" goes (approval and reinstatement). */
  dashboardUrl: string
}

const FOOTER = "Visit My London — an independent London travel guide."

function greeting(name?: string | null): string {
  const trimmed = name?.trim()

  return trimmed ? `Hi ${trimmed},` : "Hi there,"
}

function reasonLine(reason?: string): string[] {
  const trimmed = reason?.trim()

  return trimmed ? [`Reason: ${trimmed}`] : []
}

/** Sent once when an admin approves a vendor application. */
export function vendorApprovedEmail(
  input: VendorStatusEmailInput
): TemplateContent {
  const subject = "Your vendor application has been approved"
  const { html, text } = renderLayout({
    heading: "You're approved to sell on Visit My London",
    preview: `${input.vendorName} has been approved.`,
    paragraphs: [
      greeting(input.name),
      `Good news: ${input.vendorName} has been approved.`,
      "Next, finish setting up payouts so you can publish listings and get paid.",
    ],
    action: { label: "Open your vendor dashboard", url: input.dashboardUrl },
    footer: FOOTER,
  })

  return { subject, html, text }
}

/** Sent once when an admin rejects a vendor application. */
export function vendorRejectedEmail(
  input: VendorStatusEmailInput
): TemplateContent {
  const subject = "An update on your vendor application"
  const { html, text } = renderLayout({
    heading: "Your application wasn't approved",
    preview: `We couldn't approve ${input.vendorName} this time.`,
    paragraphs: [
      greeting(input.name),
      `We reviewed ${input.vendorName} and weren't able to approve it this time.`,
      ...reasonLine(input.reason),
      "You're welcome to apply again once this has been addressed.",
    ],
    footer: FOOTER,
  })

  return { subject, html, text }
}

/** Sent once when an admin suspends an approved vendor. */
export function vendorSuspendedEmail(
  input: VendorStatusEmailInput
): TemplateContent {
  const subject = "Your vendor account has been suspended"
  const { html, text } = renderLayout({
    heading: "Your vendor account is suspended",
    preview: `${input.vendorName} has been suspended.`,
    paragraphs: [
      greeting(input.name),
      `${input.vendorName} has been suspended. Your listings are no longer visible to the public and new bookings are paused.`,
      ...reasonLine(input.reason),
      "If you think this is a mistake, please contact our support team.",
    ],
    footer: FOOTER,
  })

  return { subject, html, text }
}

/** Sent once when an admin reinstates a suspended vendor. */
export function vendorReinstatedEmail(
  input: VendorStatusEmailInput
): TemplateContent {
  const subject = "Your vendor account has been reinstated"
  const { html, text } = renderLayout({
    heading: "Your vendor account is active again",
    preview: `${input.vendorName} has been reinstated.`,
    paragraphs: [
      greeting(input.name),
      `${input.vendorName} has been reinstated. Your listings are visible again and you can take bookings.`,
    ],
    action: { label: "Open your vendor dashboard", url: input.dashboardUrl },
    footer: FOOTER,
  })

  return { subject, html, text }
}
