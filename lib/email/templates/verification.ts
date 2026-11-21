import { formatDuration, renderLayout, type TemplateContent } from "./layout"

export type VerificationEmailInput = {
  name?: string | null
  url: string
  expiresInHours?: number
}

/**
 * Sent when an account is created or a verification email is requested.
 * The URL already carries the token; the token is never rendered separately.
 */
export function verificationEmail({
  name,
  url,
  expiresInHours = 1,
}: VerificationEmailInput): TemplateContent {
  const trimmedName = name?.trim()
  const greeting = trimmedName ? `Hi ${trimmedName},` : "Hi there,"
  const expiry = formatDuration(expiresInHours, "hour")

  const { html, text } = renderLayout({
    heading: "Confirm your email address",
    preview:
      "Confirm your email to finish setting up your Visit My London account.",
    paragraphs: [
      greeting,
      "Confirm your email to finish setting up your Visit My London account.",
      `This link expires in ${expiry}. If you didn't create an account, you can ignore this email.`,
    ],
    action: { label: "Confirm email", url },
    footer: "Visit My London — an independent London travel guide.",
  })

  return {
    subject: "Confirm your email address",
    html,
    text,
  }
}
