import { beforeEach, describe, expect, it } from "vitest"
import { createAuthEmailSenders } from "@/lib/email/auth-senders"
import { InProcessEmailQueue } from "@/lib/email/in-process-queue"
import type { EmailQueue } from "@/lib/email/queue"

const url = "https://app.example.com/verify?token=abc123"
const user = { email: "ada@example.com", name: "Ada Lovelace" }

describe("createAuthEmailSenders", () => {
  let queue: InProcessEmailQueue

  beforeEach(() => {
    queue = new InProcessEmailQueue()
  })

  it("TC-E0S1-03: enqueues one verification email for the user", async () => {
    const senders = createAuthEmailSenders(queue)

    await senders.sendVerificationEmail({ user, url, token: "abc123" })

    expect(queue.messages).toHaveLength(1)
    expect(queue.messages[0]).toMatchObject({
      to: user.email,
      subject: "Confirm your email address",
      tags: { kind: "verification" },
    })
    expect(queue.messages[0].html).toContain("token=abc123")
    expect(queue.messages[0].text).toContain(url)
  })

  it("TC-E0S1-03: enqueues one password-reset email for the user", async () => {
    const senders = createAuthEmailSenders(queue)

    await senders.sendResetPassword({ user, url, token: "abc123" })

    expect(queue.messages).toHaveLength(1)
    expect(queue.messages[0]).toMatchObject({
      to: user.email,
      subject: "Reset your password",
      tags: { kind: "password-reset" },
    })
    expect(queue.messages[0].text).toContain(url)
  })

  it("TC-E0S1-03: adds the configured reply-to address", async () => {
    const senders = createAuthEmailSenders(queue, {
      replyTo: "support@visitmylondon.test",
    })

    await senders.sendVerificationEmail({ user, url, token: "abc123" })

    expect(queue.messages[0].replyTo).toBe("support@visitmylondon.test")
  })

  it("TC-E0S1-03: propagates queue failures so the request can fail", async () => {
    const failingQueue: EmailQueue = {
      async enqueue() {
        throw new Error("queue down")
      },
    }
    const senders = createAuthEmailSenders(failingQueue)

    await expect(
      senders.sendVerificationEmail({ user, url, token: "abc123" })
    ).rejects.toThrow("queue down")
    await expect(
      senders.sendResetPassword({ user, url, token: "abc123" })
    ).rejects.toThrow("queue down")
  })
})
