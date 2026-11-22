import type { Prisma } from "@prisma/client"
import type { Db } from "pg-boss"

/**
 * Lets pg-boss run its SQL through a Prisma transaction, so a job is inserted
 * (or rolled back) together with the rows around it. The app database and the
 * `pgboss` schema are the same Postgres database, so one transaction can span
 * both.
 */
export function prismaTransactionDb(
  tx: Pick<Prisma.TransactionClient, "$queryRawUnsafe">
): Db {
  return {
    async executeSql(text, values = []) {
      const rows = await tx.$queryRawUnsafe<unknown[]>(text, ...values)

      return { rows: rows as Array<Record<string, unknown>> }
    },
  }
}
