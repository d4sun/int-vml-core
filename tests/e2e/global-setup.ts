import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { seedDatabase } from "../../prisma/seed-core"
import { E2E_OUTBOX_DIR } from "../../playwright.config"

/**
 * Prepares the world the specs run in: a migrated, seeded database, an empty
 * email outbox and the pg-boss worker that delivers queued email into it.
 * Returns the teardown that stops the worker.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) throw new Error("DATABASE_URL is required for e2e")

  const env = {
    ...process.env,
    DIRECT_URL: process.env.DIRECT_URL ?? databaseUrl,
    EMAIL_OUTBOX_DIR: E2E_OUTBOX_DIR,
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET ??
      "e2e-only-secret-not-used-in-production",
  }

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env,
    stdio: "inherit",
  })

  const prisma = new PrismaClient()

  try {
    await seedDatabase(prisma)
  } finally {
    await prisma.$disconnect()
  }

  rmSync(E2E_OUTBOX_DIR, { recursive: true, force: true })
  mkdirSync(E2E_OUTBOX_DIR, { recursive: true })

  const worker = spawn("pnpm", ["exec", "tsx", "scripts/jobs-worker.ts"], {
    env: {
      ...env,
      // The worker must use the file outbox, never a real provider.
      NODE_ENV: "development",
      BREVO_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "inherit"],
  })

  await waitForWorker(worker)

  return async () => {
    worker.kill("SIGTERM")
  }
}

function waitForWorker(worker: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The jobs worker did not start within 60s")),
      60_000
    )

    worker.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`The jobs worker exited early (code ${code})`))
    })

    worker.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk)

      if (chunk.toString().includes("jobs worker started")) {
        clearTimeout(timer)
        worker.removeAllListeners("exit")
        resolve()
      }
    })
  })
}
