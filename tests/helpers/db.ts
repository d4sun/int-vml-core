import { execFileSync } from "node:child_process"
import { PrismaClient } from "@prisma/client"

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL

  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is required for integration tests (must be a direct/session connection, not the transaction pooler)."
    )
  }

  const database = new URL(url).pathname.replace(/^\//, "")

  if (!/test/i.test(database)) {
    throw new Error(
      `Refusing to run integration tests against "${database}": the database name must contain "test".`
    )
  }

  return url
}

export function applyMigrations(): void {
  const url = testDatabaseUrl()

  execFileSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "prisma", "migrate", "deploy"],
    {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    }
  )
}

export function createTestPrismaClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: testDatabaseUrl() })
}

/**
 * Empties the public schema only. The `pgboss` schema is owned by pg-boss and
 * must survive between test files.
 */
export async function truncatePublicSchema(
  prisma: PrismaClient
): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '_prisma%'
  `

  if (tables.length === 0) return

  const list = tables
    .map(({ tablename }) => `"public"."${tablename}"`)
    .join(", ")

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`
  )
}

/**
 * The test database URL for pg-boss, which uses a plain `pg` connection and
 * does not understand Prisma's `connection_limit` and `pgbouncer` options.
 */
export function plainJobsUrl(): string {
  const url = new URL(testDatabaseUrl())

  url.searchParams.delete("connection_limit")
  url.searchParams.delete("pgbouncer")

  return url.toString()
}
