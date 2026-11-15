import type { ConstructorOptions } from "pg-boss"

/** pg-boss owns a schema of its own, created by a Prisma migration. */
export const JOBS_SCHEMA = "pgboss"

export type JobEnv = Record<string, string | undefined>

/**
 * pg-boss needs a session/direct connection (advisory locks, LISTEN/NOTIFY).
 * The transaction-mode pooler used by Prisma cannot serve it, so prefer
 * `JOBS_DATABASE_URL`, then `DIRECT_URL`, and only then `DATABASE_URL`.
 */
export function jobConnectionString(env: JobEnv = process.env): string {
  const url = env.JOBS_DATABASE_URL ?? env.DIRECT_URL ?? env.DATABASE_URL

  if (!url) {
    throw new Error(
      "No database connection for jobs. Set JOBS_DATABASE_URL or DIRECT_URL."
    )
  }

  return url
}

export function bossOptions(connectionString: string): ConstructorOptions {
  return {
    connectionString,
    schema: JOBS_SCHEMA,
    // DDL is versioned in prisma/migrations, never applied at runtime.
    migrate: false,
    supervise: false,
    max: 5,
    application_name: "vml-jobs",
  }
}
