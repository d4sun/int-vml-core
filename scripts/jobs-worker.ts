import "dotenv/config"
import { FileEmailSender } from "../lib/email/file-sender"
import { startBoss } from "../lib/jobs/boss"
import { consoleJobLogger } from "../lib/jobs/logger"
import { registerWorkers } from "../lib/jobs/register"

const outboxDir = process.env.EMAIL_OUTBOX_DIR

if (!outboxDir) {
  throw new Error(
    "EMAIL_OUTBOX_DIR is required until the Resend sender lands (E0-S1-03)"
  )
}

const boss = await startBoss({ supervise: true, logger: consoleJobLogger })

await registerWorkers(boss, {
  emailSender: new FileEmailSender(outboxDir),
  logger: consoleJobLogger,
})

consoleJobLogger.info("jobs worker started")

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  consoleJobLogger.info("jobs worker stopping", { signal })

  try {
    await boss.stop({ graceful: true, close: true })
    process.exit(0)
  } catch (error) {
    consoleJobLogger.error("jobs worker failed to stop cleanly", error)
    process.exit(1)
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
