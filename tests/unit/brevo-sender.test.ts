import { describe, expect, it, vi } from "vitest"
import {
  BREVO_ENDPOINT,
  BrevoEmailSender,
  brevoPayload,
} from "@/lib/email/brevo-sender"
import { createEmailSender } from "@/lib/email/factory"
import { FileEmailSender } from "@/lib/email/file-sender"
import type { EmailMessage } from "@/lib/email/types"

const message: EmailMessage = {
  to: "tourist@example.com",
  subject: "Confirm your email",
  html: "<p>Confirm</p>",
  text: "Confirm",
  replyTo: "support@visitmylondon.test",
  tags: { kind: "verification" },
}

type Call = { url: string; init: RequestInit }

function recordingFetch(createResponse: () => Response) {
  const calls: Call[] = []

  const fetchImplementation: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} })
    return createResponse()
  }

  return { calls, fetchImplementation }
}

function jsonResponse(messageId: string): Response {
  return new Response(JSON.stringify({ messageId }), {
    status: 201,
    headers: { "content-type": "application/json" },
  })
}

describe("BrevoEmailSender", () => {
  it("TC-E0S1-03: sends the mapped payload to Brevo and returns its message id", async () => {
    const { calls, fetchImplementation } = recordingFetch(() =>
      jsonResponse("<abc@brevo>")
    )

    const sender = new BrevoEmailSender({
      apiKey: "xkeysib-test",
      from: { email: "hello@visitmylondon.test", name: "VisitMyLondon" },
      fetch: fetchImplementation,
    })

    const delivery = await sender.send(message)

    expect(delivery).toEqual({ id: "<abc@brevo>" })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(BREVO_ENDPOINT)
    expect(calls[0].init.method).toBe("POST")

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers["api-key"]).toBe("xkeysib-test")
    expect(headers["content-type"]).toBe("application/json")

    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      sender: { email: "hello@visitmylondon.test", name: "VisitMyLondon" },
      to: [{ email: "tourist@example.com" }],
      subject: "Confirm your email",
      htmlContent: "<p>Confirm</p>",
      textContent: "Confirm",
      replyTo: { email: "support@visitmylondon.test" },
      tags: ["kind:verification"],
    })
  })

  it("TC-E0S1-03: omits optional fields the message does not carry", () => {
    const payload = brevoPayload(
      { email: "hello@visitmylondon.test" },
      { to: "a@b.co", subject: "Hi", html: "<p>Hi</p>" }
    )

    expect(payload).toEqual({
      sender: { email: "hello@visitmylondon.test" },
      to: [{ email: "a@b.co" }],
      subject: "Hi",
      htmlContent: "<p>Hi</p>",
    })
    expect("textContent" in payload).toBe(false)
    expect("replyTo" in payload).toBe(false)
    expect("tags" in payload).toBe(false)
  })

  it("TC-E0S1-03: surfaces provider rejections without leaking the API key", async () => {
    const { fetchImplementation } = recordingFetch(
      () =>
        new Response('{"code":"invalid_parameter","message":"bad sender"}', {
          status: 400,
        })
    )

    const sender = new BrevoEmailSender({
      apiKey: "xkeysib-super-secret",
      from: { email: "hello@visitmylondon.test" },
      fetch: fetchImplementation,
    })

    await expect(sender.send(message)).rejects.toThrow(
      /Brevo rejected the email \(400\)/
    )

    const error = await sender.send(message).catch((reason: Error) => reason)

    expect(error).toBeInstanceOf(Error)
    const errorMessage = (error as Error).message
    expect(errorMessage).toContain("bad sender")
    expect(errorMessage).not.toContain("xkeysib-super-secret")
  })

  it("TC-E0S1-03: wraps network failures so the job is retried", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.brevo.com")
    })

    const sender = new BrevoEmailSender({
      apiKey: "xkeysib-test",
      from: { email: "hello@visitmylondon.test" },
      fetch: fetchImplementation,
    })

    await expect(sender.send(message)).rejects.toThrow(
      /Brevo request failed: getaddrinfo/
    )
  })

  it("TC-E0S1-03: rejects a missing API key or sender at construction", () => {
    expect(
      () => new BrevoEmailSender({ apiKey: "", from: { email: "a@b.co" } })
    ).toThrow(/BREVO_API_KEY/)
    expect(
      () => new BrevoEmailSender({ apiKey: "key", from: { email: "" } })
    ).toThrow(/EMAIL_FROM/)
  })
})

describe("email transport selection", () => {
  it("TC-E0S1-03: selects Brevo when configured", () => {
    const selection = createEmailSender({
      BREVO_API_KEY: "xkeysib-test",
      EMAIL_FROM: "hello@visitmylondon.test",
      EMAIL_FROM_NAME: "VisitMyLondon",
    })

    expect(selection.transport).toBe("brevo")
    expect(selection.sender).toBeInstanceOf(BrevoEmailSender)
  })

  it("TC-E0S1-03: requires EMAIL_FROM when a Brevo key is present", () => {
    expect(() => createEmailSender({ BREVO_API_KEY: "xkeysib-test" })).toThrow(
      /EMAIL_FROM/
    )
  })

  it("TC-E0S1-03: refuses to silently drop email in production", () => {
    expect(() => createEmailSender({ NODE_ENV: "production" })).toThrow(
      /No email transport configured/
    )
  })

  it("TC-E0S1-03: falls back to the file outbox outside production", () => {
    const selection = createEmailSender({
      NODE_ENV: "development",
      EMAIL_OUTBOX_DIR: ".tmp/test-outbox",
    })

    expect(selection.transport).toBe("file")
    expect(selection.sender).toBeInstanceOf(FileEmailSender)
  })
})
