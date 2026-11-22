import { describe, expect, it } from "vitest"
import {
  APPLICATION_EXCERPT_LENGTH,
  excerpt,
  vendorApplicationReceivedEmail,
} from "@/lib/email/templates"
import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import type { SessionSource } from "@/lib/auth/guards"
import { applyAsVendor } from "@/lib/services/vendor-application"
import {
  APPLICATION_EMAIL_KIND,
  buildApplicationEmail,
  notifyAdminsOfApplication,
} from "@/lib/services/vendor-notifications"
import { RecordingTransactionalQueue } from "../helpers/recording-transactional-queue"

const base = {
  name: "Ada",
  vendorName: "Thames Tours",
  applicantName: "Olive Owner",
  applicantEmail: "olive@example.com",
  reviewUrl: "https://vml.example/admin/vendors/v1",
}

describe("application email template", () => {
  it("TC-E4S1-49: says who applied, for what, and links to the review page in both formats", () => {
    const mail = vendorApplicationReceivedEmail({
      ...base,
      description: "Walking tours of the South Bank.",
    })

    expect(mail.subject).toBe("New vendor application: Thames Tours")
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain("Olive Owner")
      expect(body).toContain("olive@example.com")
      expect(body).toContain("Thames Tours")
      expect(body).toContain("Walking tours of the South Bank.")
      expect(body).toContain("https://vml.example/admin/vendors/v1")
    }
    expect(mail.html).toContain("Hi Ada,")
  })

  it("TC-E4S1-50: without a description there is no 'They say' line, and a missing name gets a neutral greeting", () => {
    const mail = vendorApplicationReceivedEmail({ ...base, name: null })

    expect(mail.text).not.toContain("They say")
    expect(mail.text).not.toContain("undefined")
    expect(mail.html).toContain("Hi there,")
  })

  it("TC-E4S1-51: everything the applicant wrote is escaped, so it cannot inject markup into an admin's inbox", () => {
    const mail = vendorApplicationReceivedEmail({
      ...base,
      vendorName: '<img src=x onerror="alert(1)">',
      applicantName: "<b>Olive</b>",
      description: "</p><script>alert(1)</script>",
    })

    expect(mail.html).not.toContain("<script>")
    expect(mail.html).not.toContain("<img")
    expect(mail.html).not.toContain("<b>Olive</b>")
    expect(mail.html).toContain("&lt;script&gt;")
  })

  it("TC-E4S1-52: a long description is cut at a word boundary with an ellipsis, a short one is untouched", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ")
    const cut = excerpt(words)

    expect(cut.length).toBeLessThanOrEqual(APPLICATION_EXCERPT_LENGTH + 1)
    expect(cut.endsWith("…")).toBe(true)
    // It stops on a whole word of the original, never mid-word.
    expect(words.split(" ")).toContain(cut.slice(0, -1).split(" ").pop())
    expect(words.startsWith(cut.slice(0, -1))).toBe(true)
    expect(excerpt("  short text  ")).toBe("short text")
    expect(excerpt("x".repeat(APPLICATION_EXCERPT_LENGTH + 50)).length).toBe(
      APPLICATION_EXCERPT_LENGTH + 1
    )
  })
})

const notice = (overrides = {}) => ({
  auditId: "audit-1",
  vendor: { id: "v1", name: "Thames Tours", description: "Tours." },
  applicant: { name: "Olive Owner", email: "olive@example.com" },
  appUrl: "https://vml.example/",
  ...overrides,
})

const fakeTx = (admins: Array<{ name: string; email: string }>) =>
  ({
    user: { findMany: async () => admins },
    $queryRawUnsafe: async () => [],
  }) as never

describe("notifyAdminsOfApplication", () => {
  it("TC-E4S1-53: builds the email for an admin with the right kind and review link (no double slash)", () => {
    const message = buildApplicationEmail(
      { email: "ada@example.com", name: "Ada" },
      notice()
    )

    expect(message.to).toBe("ada@example.com")
    expect(message.tags).toEqual({ kind: APPLICATION_EMAIL_KIND })
    expect(message.html).toContain("https://vml.example/admin/vendors/v1")
    expect(message.html).not.toContain("example//admin")
  })

  it("TC-E4S1-54: every administrator gets exactly one email, each with its own job id", async () => {
    const queue = new RecordingTransactionalQueue()

    const created = await notifyAdminsOfApplication(
      fakeTx([
        { name: "Ada", email: "ada@example.com" },
        { name: "Bo", email: "bo@example.com" },
      ]),
      queue,
      notice()
    )

    expect(created).toBe(2)
    expect(queue.messages.map((m) => m.to).sort()).toEqual([
      "ada@example.com",
      "bo@example.com",
    ])
    expect(queue.jobs.size).toBe(2)
  })

  it("TC-E4S1-55: repeating the notification creates nothing more, and a different application is a different email", async () => {
    const queue = new RecordingTransactionalQueue()
    const tx = fakeTx([{ name: "Ada", email: "ada@example.com" }])

    await notifyAdminsOfApplication(tx, queue, notice())
    expect(await notifyAdminsOfApplication(tx, queue, notice())).toBe(0)
    expect(queue.messages).toHaveLength(1)

    await notifyAdminsOfApplication(tx, queue, notice({ auditId: "audit-2" }))
    expect(queue.messages).toHaveLength(2)
  })

  it("TC-E4S1-56: with no administrator nothing is queued and nothing fails; duplicate addresses collapse", async () => {
    const none = new RecordingTransactionalQueue()
    expect(await notifyAdminsOfApplication(fakeTx([]), none, notice())).toBe(0)
    expect(none.messages).toHaveLength(0)

    const dup = new RecordingTransactionalQueue()
    await notifyAdminsOfApplication(
      fakeTx([
        { name: "Ada", email: "Ada@Example.com" },
        { name: "Ada 2", email: "ada@example.com" },
      ]),
      dup,
      notice()
    )
    expect(dup.messages).toHaveLength(1)
  })
})

const tourist: SessionSource = async () => ({
  user: {
    id: "u1",
    email: "olive@example.com",
    name: "Olive Owner",
    emailVerified: true,
    platformRole: "TOURIST",
  },
})

/** A transaction that records the order things happen in. */
function applyTx(order: string[]) {
  return {
    $queryRaw: async () => [{ id: "u1" }],
    vendor: {
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => {
        order.push("create-vendor")
        return {
          id: "v1",
          name: "Thames Tours",
          slug: "thames-tours-aaaaaa",
          status: "PENDING",
        }
      },
    },
    user: {
      findMany: async () => {
        order.push("find-admins")
        return [{ name: "Ada", email: "ada@example.com" }]
      },
    },
    $queryRawUnsafe: async () => [],
  }
}

describe("applyAsVendor notifies inside its transaction", () => {
  it("TC-E4S1-57: admins are emailed after the vendor and its audit row exist, with the applicant's details", async () => {
    const order: string[] = []
    const queue = new RecordingTransactionalQueue()
    const db = {
      $transaction: async (fn: (t: never) => unknown) =>
        fn(applyTx(order) as never),
    } as never

    await applyAsVendor(
      { name: "Thames Tours", description: "Walking tours." },
      {
        session: tourist,
        db,
        emailQueue: queue,
        appUrl: "https://vml.example",
        record: async () => {
          order.push("audit")
          return "audit-1"
        },
      }
    )

    expect(order).toEqual(["create-vendor", "audit", "find-admins"])
    expect(queue.messages).toHaveLength(1)
    expect(queue.messages[0]).toMatchObject({
      to: "ada@example.com",
      tags: { kind: "vendor-application" },
    })
    expect(queue.messages[0]?.text).toContain("Olive Owner")
    expect(queue.messages[0]?.text).toContain("olive@example.com")
    expect(queue.messages[0]?.text).toContain("Walking tours.")
    expect(queue.messages[0]?.text).toContain(
      "https://vml.example/admin/vendors/v1"
    )
  })

  it("TC-E4S1-58: if the email cannot be queued the application fails (so the transaction rolls back)", async () => {
    const broken: TransactionalEmailQueue = {
      async enqueueInTransaction() {
        throw new Error("queue unavailable")
      },
    }
    const db = {
      $transaction: async (fn: (t: never) => unknown) =>
        fn(applyTx([]) as never),
    } as never

    await expect(
      applyAsVendor(
        { name: "Thames Tours" },
        {
          session: tourist,
          db,
          emailQueue: broken,
          appUrl: "https://vml.example",
          record: async () => "audit-1",
        }
      )
    ).rejects.toThrow("queue unavailable")
  })
})
