import { createHash } from "node:crypto"
import type { DBAdapter } from "better-auth"

/**
 * Sign-in attempts allowed per account inside the window, whichever IPs they
 * come from. This is what stops a distributed guess against one account; the
 * per-IP rule alone cannot.
 */
export const SIGN_IN_ACCOUNT_LIMIT = { window: 15 * 60, max: 10 } as const

export const THROTTLE_MESSAGE = "Too many requests. Please try again later."

type ThrottleAdapter = Pick<
  DBAdapter,
  "count" | "create" | "deleteMany" | "findMany"
>

type ConsumeResult = { allowed: true } | { allowed: false; retryAfter: number }

// Attempts are stored as short-lived `Verification` rows, one per attempt. The
// `RateLimit` table is not used: Better Auth prunes it by its own (shorter)
// windows, which would silently cut this window short.
const MODEL = "verification"

/**
 * The key is a hash of the normalised email, so the table holds no addresses
 * and an unknown address is throttled exactly like a real one (CR-9).
 */
export function accountThrottleKey(email: string): string {
  const digest = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")

  return `sign-in-account:${digest}`
}

function activeAttempts(key: string, now: Date) {
  return [
    { field: "identifier", value: key },
    { field: "expiresAt", operator: "gt" as const, value: now },
  ]
}

/**
 * Spends one attempt before the password is checked. Insert-then-recount keeps
 * concurrent guesses honest: the (max + 1)th row always sees more than `max`
 * rows, so at most `max` attempts can ever pass. Once the account is already
 * over the limit nothing is inserted, so an attack cannot grow the table.
 */
export async function consumeAccountAttempt(
  adapter: ThrottleAdapter,
  email: string,
  options: { now?: Date; rule?: { window: number; max: number } } = {}
): Promise<ConsumeResult> {
  const now = options.now ?? new Date()
  const rule = options.rule ?? SIGN_IN_ACCOUNT_LIMIT
  const key = accountThrottleKey(email)
  const where = activeAttempts(key, now)

  const blocked = async (): Promise<ConsumeResult> => {
    const [oldest] = await adapter.findMany<{ expiresAt: Date }>({
      model: MODEL,
      where,
      sortBy: { field: "expiresAt", direction: "asc" },
      limit: 1,
    })
    const until = oldest ? new Date(oldest.expiresAt).getTime() : now.getTime()

    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((until - now.getTime()) / 1000)),
    }
  }

  await adapter.deleteMany({
    model: MODEL,
    where: [
      { field: "identifier", value: key },
      { field: "expiresAt", operator: "lte", value: now },
    ],
  })

  if ((await adapter.count({ model: MODEL, where })) >= rule.max) {
    return blocked()
  }

  await adapter.create({
    model: MODEL,
    data: {
      identifier: key,
      value: "attempt",
      expiresAt: new Date(now.getTime() + rule.window * 1000),
    },
  })

  if ((await adapter.count({ model: MODEL, where })) > rule.max) {
    return blocked()
  }

  return { allowed: true }
}

/** A successful sign-in forgives earlier failures for that account. */
export async function clearAccountAttempts(
  adapter: ThrottleAdapter,
  email: string
): Promise<void> {
  await adapter.deleteMany({
    model: MODEL,
    where: [{ field: "identifier", value: accountThrottleKey(email) }],
  })
}
