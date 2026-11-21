import { createAuth, prismaAuthDatabase, type Auth } from "@/lib/auth/config"
import { getEnv } from "@/lib/env"
import type { EmailQueue } from "@/lib/email/queue"
import { getBoss, PgBossEmailQueue } from "@/lib/jobs"
import { prisma } from "@/lib/prisma"

/** Producer-side queue: starts the shared pg-boss instance on first send. */
const durableEmailQueue: EmailQueue = {
  async enqueue(message) {
    return new PgBossEmailQueue(await getBoss()).enqueue(message)
  },
}

const globalForAuth = globalThis as unknown as { vmlAuth?: Auth }

/**
 * The application's Better Auth instance. Built lazily so `next build` and
 * tooling that only import this module do not need the auth secret or a
 * database. Server-only.
 */
export function getAuth(): Auth {
  const env = getEnv()

  globalForAuth.vmlAuth ??= createAuth({
    database: prismaAuthDatabase(prisma),
    emailQueue: durableEmailQueue,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET ?? "",
  })

  return globalForAuth.vmlAuth
}
