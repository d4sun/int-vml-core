import "dotenv/config"
import { createEmailSender } from "../lib/email/factory"
import { startBoss } from "../lib/jobs/boss"
import { consoleJobLogger } from "../lib/jobs/logger"
import { registerWorkers } from "../lib/jobs/register"

const { sender: emailSender, transport: emailTransport } = createEmailSender()

const boss = await startBoss({ supervise: true, logger: consoleJobLogger })

await registerWorkers(boss, {
  emailSender,
  logger: consoleJobLogger,
})

consoleJobLogger.info("jobs worker started", { emailTransport })

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
