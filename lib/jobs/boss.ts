import { PgBoss } from "pg-boss"
import { bossOptions, jobConnectionString } from "./config"
import { consoleJobLogger, type JobLogger } from "./logger"

export type BossConfig = {
  connectionString?: string
  supervise?: boolean
  logger?: JobLogger
}

export function createBoss(config: BossConfig = {}): PgBoss {
  const logger = config.logger ?? consoleJobLogger
  const boss = new PgBoss({
    ...bossOptions(config.connectionString ?? jobConnectionString()),
    supervise: config.supervise ?? false,
  })

  boss.on("error", (error) => logger.error("pg-boss error", error))

  return boss
}

export async function startBoss(config: BossConfig = {}): Promise<PgBoss> {
  const boss = createBoss(config)
  await boss.start()
  return boss
}

// Reuse one instance across Next.js hot reloads, like lib/prisma.ts.
const globalForJobs = globalThis as unknown as {
  vmlBoss?: Promise<PgBoss>
}

/**
 * Lazily starts the producer-side singleton. Workers must not use this: a
 * worker process starts its own instance with `supervise: true`.
 */
export function getBoss(): Promise<PgBoss> {
  globalForJobs.vmlBoss ??= startBoss()
  return globalForJobs.vmlBoss
}

export async function stopBoss(): Promise<void> {
  const pending = globalForJobs.vmlBoss
  globalForJobs.vmlBoss = undefined

  if (!pending) return

  const boss = await pending
  await boss.stop({ graceful: true, close: true })
}
