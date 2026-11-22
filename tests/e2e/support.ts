import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
} from "@playwright/test"
import { E2E_OUTBOX_DIR } from "../../playwright.config"

export const PASSWORD = "correct-horse-1"
export const SEED_PASSWORD = "Seed-password-1"

export const SEED = {
  admin: "admin@seed.vml.test",
  owner: "owner@seed.vml.test",
  tourist: "tourist@seed.vml.test",
} as const

export type EmailKind =
  | "verification"
  | "password-reset"
  | "vendor-approved"
  | "vendor-rejected"
  | "vendor-suspended"
  | "vendor-reinstated"

type OutboxMessage = {
  to: string
  subject: string
  text?: string
  html: string
  tags?: { kind?: string }
}

let ipCounter = 0

/** A client IP no other test uses, so per-IP rate limits never couple tests. */
function uniqueIp(): string {
  ipCounter += 1
  const run = Number(process.env.E2E_RUN ?? Date.now()) % 200
  return `10.${run}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`
}

export const test = base.extend<{ clientIp: string }>({
  clientIp: [
    async ({ context }, provide) => {
      const ip = uniqueIp()
      await context.setExtraHTTPHeaders({ "x-forwarded-for": ip })
      await provide(ip)
    },
    { auto: true },
  ],
  // API calls made by a test come from that test's own IP too, so they share
  // its rate-limit buckets with its browser and never with another test.
  request: async ({ playwright, baseURL, clientIp }, provide) => {
    const context = await playwright.request.newContext({
      baseURL,
      // Browsers always send Origin; Better Auth refuses cookie-bearing writes
      // without it (CSRF), which this context becomes after a verification.
      extraHTTPHeaders: { "x-forwarded-for": clientIp, origin: baseURL! },
    })

    await provide(context)
    await context.dispose()
  },
})

export { expect }

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${randomUUID()}@example.com`
}

async function readOutbox(): Promise<OutboxMessage[]> {
  try {
    const raw = await readFile(
      path.join(E2E_OUTBOX_DIR, "outbox.jsonl"),
      "utf8"
    )

    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as OutboxMessage)
  } catch {
    return []
  }
}

/** Waits for the worker to deliver the `index`th (0-based) mail of a kind. */
export async function waitForEmail(
  to: string,
  kind: EmailKind,
  index = 0
): Promise<OutboxMessage> {
  await expect
    .poll(
      async () =>
        (await readOutbox()).filter((m) => m.to === to && m.tags?.kind === kind)
          .length,
      { timeout: 30_000, message: `no ${kind} email for ${to}` }
    )
    .toBeGreaterThan(index)

  return (await readOutbox()).filter(
    (m) => m.to === to && m.tags?.kind === kind
  )[index]!
}

export async function countEmails(
  to: string,
  kind: EmailKind
): Promise<number> {
  return (await readOutbox()).filter(
    (m) => m.to === to && m.tags?.kind === kind
  ).length
}

export function linkIn(message: OutboxMessage): string {
  const match = (message.text ?? message.html).match(/https?:\/\/[^\s"'<>]+/)

  if (!match) throw new Error("No link in email")

  return match[0].replace(/&amp;/g, "&")
}

/** Signs a user up through the API and fails loudly (with the body) if refused. */
export async function signUpViaApi(
  request: APIRequestContext,
  email: string,
  name = "E2E User"
): Promise<void> {
  const response = await request.post("/api/auth/sign-up/email", {
    data: { name, email, password: PASSWORD },
  })

  expect(
    response.ok(),
    `sign-up for ${email} returned ${response.status()}: ${await response.text()}`
  ).toBe(true)
}

/** Creates a verified user through the API, without touching the UI. */
export async function createVerifiedUser(
  request: APIRequestContext,
  name = "E2E User"
): Promise<{ email: string; password: string }> {
  const email = uniqueEmail()

  await signUpViaApi(request, email, name)

  const message = await waitForEmail(email, "verification")
  const verify = await request.get(linkIn(message), { maxRedirects: 0 })
  expect(verify.status()).toBe(302)

  return { email, password: PASSWORD }
}

export async function signInViaUi(
  page: Page,
  email: string,
  password: string,
  next?: string
): Promise<void> {
  await page.goto(
    next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"
  )
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
}

/** Asserts we were sent to sign-in with the given return path. */
export async function expectSignInRedirect(
  page: Page,
  next: string
): Promise<void> {
  await expect
    .poll(() => {
      const url = new URL(page.url())

      return url.pathname === "/sign-in" ? url.searchParams.get("next") : null
    })
    .toBe(next)
}

/** Signs in through the UI and waits until the sign-in has actually completed. */
export async function signInAndWait(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await signInViaUi(page, email, password)
  await page.waitForURL((url) => url.pathname !== "/sign-in")
}
