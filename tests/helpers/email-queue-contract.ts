import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { EmailQueue } from "@/lib/email/queue"
import type { EmailMessage } from "@/lib/email/types"

export type EmailQueueHarness = {
  queue: EmailQueue
  delivered: () => EmailMessage[]
  waitForDelivered: (count: number) => Promise<void>
  teardown: () => Promise<void>
}

const first: EmailMessage = {
  to: "tourist@example.com",
  subject: "Confirm your email",
  html: "<p>Confirm</p>",
  text: "Confirm",
}

const second: EmailMessage = {
  to: "tourist@example.com",
  subject: "Reset your password",
  html: "<p>Reset</p>",
}

/**
 * One contract, both implementations: the in-process queue in the unit
 * project and pg-boss in the integration project.
 */
export function describeEmailQueueContract(
  name: string,
  createHarness: () => Promise<EmailQueueHarness>,
  idPrefix = "TC-E0S0"
): void {
  describe(name, () => {
    let harness: EmailQueueHarness | undefined

    beforeEach(async () => {
      harness = await createHarness()
    })

    afterEach(async () => {
      await harness?.teardown()
      harness = undefined
    })

    it(`${idPrefix}-01: enqueue delivers exactly one unchanged message`, async () => {
      const jobId = await harness!.queue.enqueue(first)

      expect(jobId).toBeTruthy()

      await harness!.waitForDelivered(1)

      expect(harness!.delivered()).toEqual([first])
    })

    it(`${idPrefix}-02: two enqueues deliver two distinct messages`, async () => {
      await harness!.queue.enqueue(first)
      await harness!.queue.enqueue(second)
      await harness!.waitForDelivered(2)

      const subjects = harness!
        .delivered()
        .map((message) => message.subject)
        .sort()

      expect(subjects).toEqual(["Confirm your email", "Reset your password"])
    })
  })
}
