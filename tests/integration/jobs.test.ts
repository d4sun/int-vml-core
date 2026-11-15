import { describe, expect, it } from "vitest"
import type { PgBoss } from "pg-boss"
import { startBoss } from "@/lib/jobs/boss"
import { ensureQueues, registerWorkers } from "@/lib/jobs/register"
import { silentJobLogger } from "@/lib/jobs/logger"
import {
  PgBossEmailQueue,
  type EmailQueueOptions,
} from "@/lib/jobs/email-queue"
import { QUEUES } from "@/lib/jobs/queues"
import type { EmailMessage } from "@/lib/email/types"
import { testDatabaseUrl } from "../helpers/db"
import {
  describeEmailQueueContract,
  type EmailQueueHarness,
} from "../helpers/email-queue-contract"
import { RecordingEmailSender } from "../helpers/recording-sender"
import { waitFor } from "../helpers/wait-for"

type Harness = EmailQueueHarness & {
  boss: PgBoss
  sender: RecordingEmailSender
}

type HarnessOptions = {
  queue?: EmailQueueOptions
  sender?: RecordingEmailSender
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const boss = await startBoss({
    connectionString: testDatabaseUrl(),
    logger: silentJobLogger,
  })

  await ensureQueues(boss)
  await boss.deleteAllJobs(QUEUES.emailSend)

  const sender = options.sender ?? new RecordingEmailSender()
  await registerWorkers(boss, { emailSender: sender, logger: silentJobLogger })

  return {
    boss,
    sender,
    queue: new PgBossEmailQueue(boss, options.queue),
    delivered: () => sender.messages,
    waitForDelivered: async (count) => {
      await waitFor(() => sender.messages.length >= count, {
        label: `pg-boss email x${count}`,
      })
    },
    teardown: async () => {
      await boss.stop({ graceful: true, close: true })
    },
  }
}

function message(subject: string): EmailMessage {
  return {
    to: "tourist@example.com",
    subject,
    html: `<p>${subject}</p>`,
    text: subject,
  }
}

describeEmailQueueContract(
  "PgBossEmailQueue (integration)",
  () => createHarness(),
  "IT-E0S0"
)

describe("pg-boss job delivery", () => {
  it("IT-E0S0-03: a failing send is retried and then delivered", async () => {
    const sender = new RecordingEmailSender()
    sender.failNext = 2

    const harness = await createHarness({
      sender,
      queue: { retryLimit: 3, retryDelay: 1, retryBackoff: false },
    })

    try {
      await harness.queue.enqueue(message("Retry me"))
      await harness.waitForDelivered(1)

      expect(sender.attempts).toBe(3)
      expect(sender.messages).toHaveLength(1)
    } finally {
      await harness.teardown()
    }
  })

  it("IT-E0S0-04: a queued job survives a worker restart", async () => {
    const connectionString = testDatabaseUrl()
    const queued = message("Survive restart")

    const producer = await startBoss({
      connectionString,
      logger: silentJobLogger,
    })

    try {
      await ensureQueues(producer)
      await producer.deleteAllJobs(QUEUES.emailSend)
      await new PgBossEmailQueue(producer, { retryLimit: 1 }).enqueue(queued)
    } finally {
      await producer.stop({ graceful: true, close: true })
    }

    const sender = new RecordingEmailSender()
    const worker = await startBoss({
      connectionString,
      logger: silentJobLogger,
    })

    try {
      await registerWorkers(worker, {
        emailSender: sender,
        logger: silentJobLogger,
      })

      await waitFor(() => sender.messages.length === 1, {
        label: "email delivered after restart",
      })

      expect(sender.messages).toEqual([queued])
    } finally {
      await worker.stop({ graceful: true, close: true })
    }
  })

  it("IT-E0S0-05: exhausted retries fail the job without blocking the queue", async () => {
    const sender = new RecordingEmailSender()
    sender.failSubject = "Never sends"

    const harness = await createHarness({
      sender,
      queue: { retryLimit: 1, retryDelay: 1, retryBackoff: false },
    })

    try {
      const jobId = await harness.queue.enqueue(message("Never sends"))

      await waitFor(
        async () => {
          const job = await harness.boss.getJobById(QUEUES.emailSend, jobId)
          return job?.state === "failed"
        },
        { label: "job moved to failed" }
      )

      expect(sender.messages).toHaveLength(0)

      sender.failSubject = undefined
      const nextId = await harness.queue.enqueue(message("Next in line"))

      expect(nextId).not.toBe(jobId)

      await harness.waitForDelivered(1)
      expect(sender.messages.map((delivered) => delivered.subject)).toEqual([
        "Next in line",
      ])
    } finally {
      await harness.teardown()
    }
  })
})

describe("email job identity", () => {
  it("IT-E0S0-06: each enqueue returns a unique job id", async () => {
    const harness = await createHarness()

    try {
      const first = await harness.queue.enqueue(message("One"))
      const second = await harness.queue.enqueue(message("Two"))

      expect(first).not.toBe(second)
      expect(first).toMatch(/^[0-9a-f-]{36}$/)
    } finally {
      await harness.teardown()
    }
  })
})
