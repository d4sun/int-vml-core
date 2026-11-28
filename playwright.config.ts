import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE_URL = `http://localhost:${PORT}`

export const E2E_OUTBOX_DIR = path.resolve(
  process.env.EMAIL_OUTBOX_DIR ?? ".tmp/e2e-outbox"
)

// Same origin for the app and Better Auth, so cookies and the origin check
// behave exactly as they do for a real visitor.
export const E2E_STRIPE_WEBHOOK_SECRET = "whsec_e2e_only_not_used_in_production"

const appEnv = {
  BETTER_AUTH_URL: BASE_URL,
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-not-used-in-production",
  EMAIL_OUTBOX_DIR: E2E_OUTBOX_DIR,
  // CI serves a production build, which refuses the in-memory Stripe fake
  // unless it is asked for by name and given its own webhook secret.
  STRIPE_ADAPTER: "fake",
  STORAGE_ADAPTER: "fake",
  STRIPE_WEBHOOK_SECRET: E2E_STRIPE_WEBHOOK_SECRET,
  NEXT_TELEMETRY_DISABLED: "1",
}

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Each test registers its own users and uses its own client IP, but the
  // outbox is one shared file, so keep the run simple and deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI builds and serves the production bundle; locally `next dev` is faster
    // to start and reuses a server that is already running.
    command: process.env.CI
      ? `pnpm build && pnpm exec next start -p ${PORT}`
      : `pnpm exec next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: appEnv,
  },
})
