import { randomUUID } from "node:crypto"
import { memoryAdapter } from "better-auth/adapters/memory"
import { createAuth, type AuthDeps } from "@/lib/auth/config"
import { InProcessEmailQueue } from "@/lib/email/in-process-queue"
import type { EmailMessage } from "@/lib/email/types"

export const TEST_BASE_URL = "http://localhost:3000"
export const TEST_SECRET = "test-secret-test-secret-test-secret-1234"

export const VALID_PASSWORD = "correct-horse-1"

type MemoryDb = Record<string, Record<string, unknown>[]>

export type AuthHarness = ReturnType<typeof makeHarness>

/**
 * Real auth config over an in-memory database and an in-process queue, driven
 * through `auth.handler` the way an HTTP request would be.
 *
 * Pass `database` to run the same flows against Prisma/Postgres.
 */
export function makeHarness(
  overrides: Partial<Pick<AuthDeps, "database">> = {}
) {
  const db: MemoryDb = { user: [], session: [], account: [], verification: [] }
  const queue = new InProcessEmailQueue()

  const auth = createAuth({
    database: overrides.database ?? memoryAdapter(db),
    emailQueue: queue,
    baseURL: TEST_BASE_URL,
    secret: TEST_SECRET,
  })

  async function request(
    path: string,
    init: { method?: "GET" | "POST"; body?: unknown; ip?: string } = {}
  ): Promise<Response> {
    const method = init.method ?? "POST"

    return auth.handler(
      new Request(`${TEST_BASE_URL}/api/auth${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          origin: TEST_BASE_URL,
          "x-forwarded-for": init.ip ?? freshIp(),
        },
        ...(method === "POST" ? { body: JSON.stringify(init.body ?? {}) } : {}),
      })
    )
  }

  return {
    auth,
    db,
    queue,
    request,
    signUp: (body: Record<string, unknown>, ip?: string) =>
      request("/sign-up/email", { body, ...(ip ? { ip } : {}) }),
    signIn: (body: Record<string, unknown>, ip?: string) =>
      request("/sign-in/email", { body, ...(ip ? { ip } : {}) }),
    /** Emails enqueued so far whose tag matches `kind`. */
    emails: (kind: string): EmailMessage[] =>
      queue.messages.filter((message) => message.tags?.kind === kind),
  }
}

let ipCounter = 0

/** Unique client IP per call so rate limits never couple tests together. */
export function freshIp(): string {
  ipCounter += 1
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`
}

export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${randomUUID()}@example.com`
}

/** Pulls the first absolute link out of an email body. */
export function extractLink(message: EmailMessage): string {
  const source = message.text ?? message.html
  const match = source.match(/https?:\/\/[^\s"'<>]+/)

  if (!match) throw new Error("No link found in email body")

  return match[0].replace(/&amp;/g, "&")
}
