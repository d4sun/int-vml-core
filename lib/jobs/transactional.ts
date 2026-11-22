import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import { getBoss } from "./boss"
import { PgBossEmailQueue } from "./email-queue"

/** Producer-side queue for the web app: starts the shared pg-boss on first use. */
export async function getTransactionalEmailQueue(): Promise<TransactionalEmailQueue> {
  return new PgBossEmailQueue(await getBoss())
}
