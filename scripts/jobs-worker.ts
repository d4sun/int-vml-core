import "dotenv/config"
import { getEnv } from "../lib/env"
import { createEmailSender } from "../lib/email/factory"
import { startBoss } from "../lib/jobs/boss"
import { jobConnectionString } from "../lib/jobs/config"
import { consoleJobLogger } from "../lib/jobs/logger"
import { registerWorkers } from "../lib/jobs/register"
import { registerPeriodicJobs } from "../lib/jobs/schedules"
import { cancelExpiredBookings } from "../lib/services/booking-cleanup"
import { settlePendingTransfers } from "../lib/services/transfers"
import { reconcileFailedTransfers } from "../lib/services/transfer-reconciliation"

// Validate the whole environment before opening any connection, so a missing
// or malformed variable fails here with a readable message.
const env = getEnv()
const { sender: emailSender, transport: emailTransport } =
  createEmailSender(env)

const boss = await startBoss({
  connectionString: jobConnectionString(env),
  supervise: true,
  logger: consoleJobLogger,
})

await registerWorkers(boss, {
  emailSender,
  logger: consoleJobLogger,
})

// Periodic work: unpaid bookings are cancelled, and vendor transfers are sent.
await registerPeriodicJobs(boss, {
  cancelExpiredBookings: () => cancelExpiredBookings(),
  settlePendingTransfers: () => settlePendingTransfers(50),
  reconcileFailedTransfers: () => reconcileFailedTransfers(50),
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
