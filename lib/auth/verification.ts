/**
 * Every verification link lands here, whatever the client asked for. The auth
 * config forces this callback on sign-up, resend and the verify endpoint, so
 * there is exactly one page that has to interpret the outcome.
 */
export const VERIFICATION_CALLBACK_PATH = "/verify-email/complete"

export type VerificationFailureReason = "expired" | "invalid"

export type VerificationOutcome =
  | { status: "verified" }
  | { status: "failed"; reason: VerificationFailureReason }
  /** No error and no verified session: show "check your email / sign in". */
  | { status: "unknown" }

/**
 * Better Auth redirects to the callback with `?error=<CODE>` when a token is
 * rejected and signs the user in on success. The absence of an error alone is
 * not proof of success (anyone can open the URL), so the page must also pass
 * whether the current session's email is verified.
 *
 * Any code other than an expired token is reported as "invalid" on purpose:
 * `USER_NOT_FOUND` would otherwise reveal that an account was deleted.
 * Failures always offer a resend.
 */
export function describeVerificationOutcome(input: {
  error?: string | null
  emailVerified?: boolean
}): VerificationOutcome {
  if (input.error) {
    return {
      status: "failed",
      reason: input.error === "TOKEN_EXPIRED" ? "expired" : "invalid",
    }
  }

  return input.emailVerified ? { status: "verified" } : { status: "unknown" }
}
