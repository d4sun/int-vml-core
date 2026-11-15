import { describe, expect, it } from "vitest"
import { InProcessEmailQueue } from "@/lib/email/in-process-queue"
import { jobConnectionString } from "@/lib/jobs/config"
import { emailSendJobSchema } from "@/lib/jobs/queues"
import { waitFor } from "../helpers/wait-for"
import { describeEmailQueueContract } from "../helpers/email-queue-contract"

describeEmailQueueContract("InProcessEmailQueue (unit)", async () => {
  const queue = new InProcessEmailQueue()

  return {
    queue,
    delivered: () => queue.messages,
    waitForDelivered: async (count) => {
      await waitFor(() => queue.messages.length >= count, {
        label: `in-process email x${count}`,
      })
    },
    teardown: async () => queue.clear(),
  }
})

describe("email job payload", () => {
  it("TC-E0S0-03: accepts a valid payload", () => {
    const parsed = emailSendJobSchema.parse({
      to: "tourist@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
      tags: { kind: "verification" },
    })

    expect(parsed.to).toBe("tourist@example.com")
  })

  it("TC-E0S0-03: rejects a malformed recipient", () => {
    expect(() =>
      emailSendJobSchema.parse({
        to: "not-an-email",
        subject: "Hello",
        html: "<p>Hello</p>",
      })
    ).toThrow()
  })

  it("TC-E0S0-03: rejects an empty subject or body", () => {
    expect(() =>
      emailSendJobSchema.parse({
        to: "tourist@example.com",
        subject: "",
        html: "<p>Hello</p>",
      })
    ).toThrow()

    expect(() =>
      emailSendJobSchema.parse({
        to: "tourist@example.com",
        subject: "Hello",
        html: "",
      })
    ).toThrow()
  })
})

describe("job connection resolution", () => {
  it("TC-E0S0-04: prefers JOBS_DATABASE_URL", () => {
    expect(
      jobConnectionString({
        JOBS_DATABASE_URL: "postgres://jobs",
        DIRECT_URL: "postgres://direct",
        DATABASE_URL: "postgres://pooled",
      })
    ).toBe("postgres://jobs")
  })

  it("TC-E0S0-04: falls back to DIRECT_URL, then DATABASE_URL", () => {
    expect(
      jobConnectionString({
        DIRECT_URL: "postgres://direct",
        DATABASE_URL: "postgres://pooled",
      })
    ).toBe("postgres://direct")

    expect(jobConnectionString({ DATABASE_URL: "postgres://pooled" })).toBe(
      "postgres://pooled"
    )
  })

  it("TC-E0S0-04: throws when no connection is configured", () => {
    expect(() => jobConnectionString({})).toThrow(/No database connection/)
  })
})
