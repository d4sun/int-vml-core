import type { DBAdapter } from "better-auth"
import { clearAccountAttempts } from "@/lib/auth/account-throttle"

/**
 * Every reset link lands here, whatever the client asked for. Better Auth
 * redirects to it with `?token=` when the link is valid and `?error=` when it
 * is not (it does not distinguish expired from unknown tokens).
 */
export const RESET_PASSWORD_PATH = "/reset-password"

export type ResetLinkOutcome =
  | { status: "ready"; token: string }
  | { status: "invalid" }
  /** Opened without a token or an error: offer to request a link. */
  | { status: "missing" }

/** An error always wins over a token, so a bad link can never show the form. */
export function describeResetLink(input: {
  token?: string | null
  error?: string | null
}): ResetLinkOutcome {
  if (input.error) return { status: "invalid" }
  if (input.token) return { status: "ready", token: input.token }

  return { status: "missing" }
}

type ResetAdapter = Pick<
  DBAdapter,
  "count" | "create" | "deleteMany" | "findMany"
>

/**
 * Runs after a password has been reset:
 *
 * - Other outstanding reset links for the account stop working, so one email
 *   thread cannot be replayed (Better Auth only consumes the link that was
 *   used).
 * - The sign-in throttle is cleared, so someone locked out by failed guesses
 *   can use the new password straight away.
 */
export async function settleAfterPasswordReset(
  adapter: ResetAdapter,
  user: { id: string; email: string }
): Promise<void> {
  await adapter.deleteMany({
    model: "verification",
    where: [
      {
        field: "identifier",
        operator: "starts_with",
        value: "reset-password:",
      },
      { field: "value", value: user.id },
    ],
  })

  await clearAccountAttempts(adapter, user.email)
}
