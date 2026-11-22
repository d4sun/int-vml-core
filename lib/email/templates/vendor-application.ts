import { renderLayout, type TemplateContent } from "./layout"

export type VendorApplicationEmailInput = {
  /** The admin's name; falls back to a neutral greeting. */
  name?: string | null
  vendorName: string
  applicantName: string
  applicantEmail: string
  /** What the applicant said they offer (shortened here). */
  description?: string
  /** The admin review page for this application. */
  reviewUrl: string
}

export const APPLICATION_EXCERPT_LENGTH = 300

/** The first `max` characters, cut at a word boundary, with an ellipsis. */
export function excerpt(
  text: string,
  max = APPLICATION_EXCERPT_LENGTH
): string {
  const trimmed = text.trim()

  if (trimmed.length <= max) return trimmed

  const cut = trimmed.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")

  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * Sent once to each admin when someone applies to become a vendor. It tells
 * them who applied and links to the review page; the decision itself is made
 * there, never from the email.
 */
export function vendorApplicationReceivedEmail(
  input: VendorApplicationEmailInput
): TemplateContent {
  const trimmedName = input.name?.trim()
  const description = input.description?.trim()

  const subject = `New vendor application: ${input.vendorName}`
  const { html, text } = renderLayout({
    heading: "A new vendor application is waiting",
    preview: `${input.applicantName} applied to sell as ${input.vendorName}.`,
    paragraphs: [
      trimmedName ? `Hi ${trimmedName},` : "Hi there,",
      `${input.applicantName} (${input.applicantEmail}) has applied to sell on Visit My London as ${input.vendorName}.`,
      ...(description ? [`They say: ${excerpt(description)}`] : []),
      "Please review the application and approve or reject it.",
    ],
    action: { label: "Review the application", url: input.reviewUrl },
    footer: "Visit My London — an independent London travel guide.",
  })

  return { subject, html, text }
}
