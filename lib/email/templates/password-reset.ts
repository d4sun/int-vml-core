import { formatDuration, renderLayout, type TemplateContent } from "./layout"

export type PasswordResetEmailInput = {
  name?: string | null
  url: string
  expiresInMinutes?: number
}

function formatExpiry(minutes: number): string {
  if (minutes % 60 === 0) {
    return formatDuration(minutes / 60, "hour")
  }

  return formatDuration(minutes, "minute")
}

/**
 * Sent by Better Auth's `sendResetPassword` callback (wired in E0-S2-03).
 * The URL already carries the single-use token.
 */
export function passwordResetEmail({
  name,
  url,
  expiresInMinutes = 60,
}: PasswordResetEmailInput): TemplateContent {
  const trimmedName = name?.trim()
  const greeting = trimmedName ? `Hi ${trimmedName},` : "Hi there,"
  const expiry = formatExpiry(expiresInMinutes)

  const { html, text } = renderLayout({
    heading: "Reset your password",
    preview: "Use the link below to choose a new password.",
    paragraphs: [
      greeting,
      "We received a request to reset the password for your Visit My London account.",
      `This link expires in ${expiry}. If you didn't request a reset, you can ignore this email and your password will stay the same.`,
    ],
    action: { label: "Reset password", url },
    footer: "Visit My London — an independent London travel guide.",
  })

  return {
    subject: "Reset your password",
    html,
    text,
  }
}
