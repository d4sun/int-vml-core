import type { PgBoss } from "pg-boss"
import { CLEANUP_CRON } from "@/lib/services/booking-cleanup"

export const JOB_NAMES = {
  bookingCleanup: "booking.cleanup",
  transferSettle: "transfer.settle",
  transferReconcile: "transfer.reconcile",
} as const

/** Every periodic job the app runs, with its cron. Idempotent: pg-boss keeps one schedule per name. */
export const PERIODIC_JOBS = [
  { name: JOB_NAMES.bookingCleanup, cron: CLEANUP_CRON },
  { name: JOB_NAMES.transferSettle, cron: "* * * * *" },
  { name: JOB_NAMES.transferReconcile, cron: "*/10 * * * *" },
] as const

export type PeriodicSchedulerBoss = Pick<
  PgBoss,
  "createQueue" | "schedule" | "work"
>

/** Registers the periodic jobs and their workers. The workers are injected so tests can run them directly. */
export async function registerPeriodicJobs(
  boss: PeriodicSchedulerBoss,
  workers: {
    cancelExpiredBookings: () => Promise<unknown>
    settlePendingTransfers: () => Promise<unknown>
    reconcileFailedTransfers: () => Promise<unknown>
  }
): Promise<void> {
  for (const job of PERIODIC_JOBS) {
    await boss.createQueue(job.name)
    await boss.schedule(job.name, job.cron)
  }

  await boss.work(JOB_NAMES.bookingCleanup, { batchSize: 1 }, async () => {
    await workers.cancelExpiredBookings()
  })
  await boss.work(JOB_NAMES.transferSettle, { batchSize: 1 }, async () => {
    await workers.settlePendingTransfers()
  })
  await boss.work(JOB_NAMES.transferReconcile, { batchSize: 1 }, async () => {
    await workers.reconcileFailedTransfers()
  })
}
