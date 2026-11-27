import { renderLayout, type TemplateContent } from "./layout"

export type ListingModerationEmailInput = {
  /** The recipient's name; falls back to a neutral greeting. */
  name?: string | null
  listingTitle: string
  /** The admin's reason, shown when a listing is turned away. */
  reason?: string
  /** Where "open your listings" goes. */
  listingsUrl: string
}

const FOOTER = "Visit My London — an independent London travel guide."

function greeting(name?: string | null): string {
  const trimmed = name?.trim()

  return trimmed ? `Hi ${trimmed},` : "Hi there,"
}

/** Sent once when an admin approves a listing: it is now public. */
export function listingApprovedEmail(
  input: ListingModerationEmailInput
): TemplateContent {
  const subject = `Your listing is live: ${input.listingTitle}`
  const { html, text } = renderLayout({
    heading: "Your listing is now live",
    preview: `${input.listingTitle} has been approved and published.`,
    paragraphs: [
      greeting(input.name),
      `"${input.listingTitle}" has been approved and is now visible to visitors.`,
    ],
    action: { label: "View your listings", url: input.listingsUrl },
    footer: FOOTER,
  })

  return { subject, html, text }
}

/** Sent once when an admin turns a listing away. The vendor can fix it and resubmit. */
export function listingRejectedEmail(
  input: ListingModerationEmailInput
): TemplateContent {
  const subject = `Changes needed: ${input.listingTitle}`
  const reason = input.reason?.trim()
  const { html, text } = renderLayout({
    heading: "This listing needs changes",
    preview: `${input.listingTitle} was not approved yet.`,
    paragraphs: [
      greeting(input.name),
      `"${input.listingTitle}" was not approved this time.`,
      ...(reason ? [`Reason: ${reason}`] : []),
      "Update the listing and submit it again for review.",
    ],
    action: { label: "Edit your listing", url: input.listingsUrl },
    footer: FOOTER,
  })

  return { subject, html, text }
}
