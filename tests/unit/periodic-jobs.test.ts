import { describe, expect, it } from "vitest"
import {
  CLEANUP_CRON,
  PAYMENT_WINDOW_MINUTES,
} from "@/lib/services/booking-cleanup"
import {
  JOB_NAMES,
  PERIODIC_JOBS,
  registerPeriodicJobs,
} from "@/lib/jobs/schedules"

describe("periodic jobs", () => {
  it("the cleanup runs every five minutes, and the payment window is thirty minutes", () => {
    expect(CLEANUP_CRON).toBe("*/5 * * * *")
    expect(PAYMENT_WINDOW_MINUTES).toBe(30)
  })

  it("registers each job once with its cron and runs its worker", async () => {
    const calls: string[] = []
    const boss = {
      async createQueue(name: string) {
        calls.push(`queue:${name}`)
      },
      async schedule(name: string, cron: string) {
        calls.push(`schedule:${name}:${cron}`)
      },
      async work(name: string, _opts: unknown, handler: () => Promise<void>) {
        calls.push(`work:${name}`)
        await handler()
      },
    }
    const ran: string[] = []

    await registerPeriodicJobs(boss as never, {
      cancelExpiredBookings: async () => ran.push("cleanup"),
      settlePendingTransfers: async () => ran.push("settle"),
    })

    expect(PERIODIC_JOBS.map((j) => j.name)).toEqual([
      JOB_NAMES.bookingCleanup,
      JOB_NAMES.transferSettle,
    ])
    expect(calls).toContain(
      `schedule:${JOB_NAMES.bookingCleanup}:${CLEANUP_CRON}`
    )
    expect(ran.sort()).toEqual(["cleanup", "settle"])
  })
})
