import { describe, expect, it } from "vitest"
import { holdExpiryJobSchema, scheduleHoldExpiry } from "@/lib/jobs/hold-expiry"
import { QUEUES, QUEUE_OPTIONS } from "@/lib/jobs/queues"

describe("hold expiry job", () => {
  it("schedules the release for the hold's expiry, once per hold", async () => {
    const sent: { queue: string; payload: unknown; options: unknown }[] = []
    const boss = {
      async send(queue: string, payload: unknown, options: unknown) {
        sent.push({ queue, payload, options })

        return "job-1"
      },
    }
    const expiresAt = new Date("2030-06-01T10:10:00Z")

    const id = await scheduleHoldExpiry(boss as never, { id: "h1", expiresAt })

    expect(id).toBe("job-1")
    expect(sent).toEqual([
      {
        queue: QUEUES.holdExpire,
        payload: { holdId: "h1" },
        options: { startAfter: expiresAt, singletonKey: "hold-expiry:h1" },
      },
    ])
  })

  it("the queue retries a few times, quickly, and keeps the job's history", () => {
    const options = QUEUE_OPTIONS[QUEUES.holdExpire]

    expect(options.retryLimit).toBe(3)
    expect(options.deleteAfterSeconds).toBeGreaterThan(0)
  })

  it("the worker refuses a payload without a hold id", () => {
    expect(holdExpiryJobSchema.safeParse({}).success).toBe(false)
    expect(holdExpiryJobSchema.safeParse({ holdId: "" }).success).toBe(false)
    expect(holdExpiryJobSchema.safeParse({ holdId: "h1" }).success).toBe(true)
  })
})
