import { describe, expect, it } from "vitest"
import {
  vendorApprovedEmail,
  vendorRejectedEmail,
  vendorReinstatedEmail,
  vendorSuspendedEmail,
} from "@/lib/email/templates"
import { deterministicUuid } from "@/lib/jobs/deterministic-id"
import {
  buildVendorEmail,
  emailJobId,
  notifyVendorTransition,
  resolveRecipients,
  vendorEmailKind,
} from "@/lib/services/vendor-notifications"
import { VENDOR_ACTIONS } from "@/lib/vendors/transitions"
import { RecordingTransactionalQueue } from "../helpers/recording-transactional-queue"

const URL = "https://vml.example/vendor"
const base = { name: "Olive", vendorName: "Thames Tours", dashboardUrl: URL }

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("vendor status templates", () => {
  it("TC-E8S1-52: approved and reinstated say so and link to the dashboard in both formats", () => {
    for (const render of [vendorApprovedEmail, vendorReinstatedEmail]) {
      const mail = render(base)

      expect(mail.subject.length).toBeGreaterThan(0)
      expect(mail.html).toContain("Hi Olive,")
      expect(mail.html).toContain("Thames Tours")
      expect(mail.html).toContain(URL)
      expect(mail.text).toContain("Thames Tours")
      expect(mail.text).toContain(URL)
    }

    expect(vendorApprovedEmail(base).subject).toBe(
      "Your vendor application has been approved"
    )
    expect(vendorReinstatedEmail(base).subject).toBe(
      "Your vendor account has been reinstated"
    )
  })

  it("TC-E8S1-53: rejected and suspended carry the reason and have nothing to click", () => {
    for (const render of [vendorRejectedEmail, vendorSuspendedEmail]) {
      const mail = render({ ...base, reason: "No trading licence" })

      expect(mail.html).toContain("Reason: No trading licence")
      expect(mail.text).toContain("Reason: No trading licence")
      expect(mail.html).not.toContain("<a ")
      expect(mail.html).not.toContain("paste this link")
      expect(mail.text).not.toContain("http")
      expect(mail.text).not.toContain("undefined")
    }

    expect(vendorSuspendedEmail(base).subject).toBe(
      "Your vendor account has been suspended"
    )
  })

  it("TC-E8S1-54: without a reason there is no empty 'Reason:' line, and a missing name gets a neutral greeting", () => {
    for (const render of [vendorRejectedEmail, vendorSuspendedEmail]) {
      const mail = render({ ...base, name: null })

      expect(mail.text).not.toContain("Reason:")
      expect(mail.html).toContain("Hi there,")
    }
  })

  it("TC-E8S1-55: admin- and vendor-supplied text is escaped, so it cannot inject markup", () => {
    const mail = vendorRejectedEmail({
      name: "<b>Olive</b>",
      vendorName: '<img src=x onerror="alert(1)">',
      reason: "</p><script>alert(1)</script>",
      dashboardUrl: URL,
    })

    expect(mail.html).not.toContain("<script>")
    expect(mail.html).not.toContain("<img")
    expect(mail.html).not.toContain("<b>Olive</b>")
    expect(mail.html).toContain("&lt;script&gt;")
  })
})

describe("recipients", () => {
  it("TC-E8S1-56: owners are told, de-duplicated case-insensitively", () => {
    expect(
      resolveRecipients(
        [
          { email: "Olive@Example.com", name: "Olive" },
          { email: "olive@example.com", name: "Olive again" },
          { email: "otto@example.com", name: "Otto" },
        ],
        "contact@example.com"
      ).map((r) => r.email)
    ).toEqual(["Olive@Example.com", "otto@example.com"])
  })

  it("TC-E8S1-57: the contact address is used only when there is no owner, and only if it is a valid email", () => {
    expect(resolveRecipients([], " contact@example.com ")).toEqual([
      { email: "contact@example.com", name: null },
    ])
    expect(resolveRecipients([], "not an email")).toEqual([])
    expect(resolveRecipients([], null)).toEqual([])
    expect(resolveRecipients([], "")).toEqual([])
  })
})

describe("job ids and messages", () => {
  it("TC-E8S1-58: ids are valid, stable UUIDs that differ by transition and by recipient but not by email case", () => {
    const a = emailJobId("audit-1", "olive@example.com")

    expect(a).toMatch(UUID)
    expect(emailJobId("audit-1", "olive@example.com")).toBe(a)
    expect(emailJobId("audit-1", "OLIVE@Example.com")).toBe(a)
    expect(emailJobId("audit-2", "olive@example.com")).not.toBe(a)
    expect(emailJobId("audit-1", "otto@example.com")).not.toBe(a)
    expect(deterministicUuid("x")).toMatch(UUID)
    expect(deterministicUuid("x")).not.toBe(deterministicUuid("y"))
  })

  it("TC-E8S1-59: each action maps to its own template and kind, and links use the app URL without a double slash", () => {
    const kinds = new Set<string>()

    for (const action of VENDOR_ACTIONS) {
      const message = buildVendorEmail(
        action,
        { email: "olive@example.com", name: "Olive" },
        {
          vendorName: "Thames Tours",
          reason: "Because",
          appUrl: "https://vml.example/",
        }
      )

      kinds.add(message.tags!.kind!)
      expect(message.to).toBe("olive@example.com")
      expect(message.tags).toEqual({ kind: vendorEmailKind(action) })
    }

    expect([...kinds].sort()).toEqual([
      "vendor-approved",
      "vendor-reinstated",
      "vendor-rejected",
      "vendor-suspended",
    ])

    const approved = buildVendorEmail(
      "approve",
      { email: "a@example.com", name: null },
      { vendorName: "V", appUrl: "https://vml.example/" }
    )
    expect(approved.html).toContain("https://vml.example/vendor")
    expect(approved.html).not.toContain("example//vendor")
  })
})

function fakeTx(owners: Array<{ name: string; email: string }>) {
  return {
    vendorMember: {
      findMany: async () => owners.map((user) => ({ user })),
    },
    $queryRawUnsafe: async () => [],
  } as never
}

const notice = (overrides = {}) => ({
  action: "approve" as const,
  auditId: "audit-1",
  vendor: { id: "v1", name: "Thames Tours", contactEmail: null },
  appUrl: "https://vml.example",
  ...overrides,
})

describe("notifyVendorTransition", () => {
  it("TC-E8S1-60: enqueues exactly one email for a vendor with one owner", async () => {
    const queue = new RecordingTransactionalQueue()

    const created = await notifyVendorTransition(
      fakeTx([{ name: "Olive", email: "olive@example.com" }]),
      queue,
      notice()
    )

    expect(created).toBe(1)
    expect(queue.messages).toHaveLength(1)
    expect(queue.messages[0]).toMatchObject({
      to: "olive@example.com",
      tags: { kind: "vendor-approved" },
    })
  })

  it("TC-E8S1-61: repeating the same notification creates nothing more (idempotent)", async () => {
    const queue = new RecordingTransactionalQueue()
    const tx = fakeTx([{ name: "Olive", email: "olive@example.com" }])

    await notifyVendorTransition(tx, queue, notice())
    const again = await notifyVendorTransition(tx, queue, notice())

    expect(again).toBe(0)
    expect(queue.messages).toHaveLength(1)
  })

  it("TC-E8S1-62: a different transition of the same vendor is a different email", async () => {
    const queue = new RecordingTransactionalQueue()
    const tx = fakeTx([{ name: "Olive", email: "olive@example.com" }])

    await notifyVendorTransition(tx, queue, notice({ auditId: "audit-1" }))
    await notifyVendorTransition(
      tx,
      queue,
      notice({ action: "suspend", auditId: "audit-2", reason: "Spike" })
    )

    expect(queue.messages.map((m) => m.tags?.kind)).toEqual([
      "vendor-approved",
      "vendor-suspended",
    ])
  })

  it("TC-E8S1-63: no recipient means no email and no failure; the contact address is the fallback", async () => {
    const none = new RecordingTransactionalQueue()
    expect(await notifyVendorTransition(fakeTx([]), none, notice())).toBe(0)
    expect(none.messages).toHaveLength(0)

    const fallback = new RecordingTransactionalQueue()
    expect(
      await notifyVendorTransition(
        fakeTx([]),
        fallback,
        notice({
          vendor: { id: "v1", name: "V", contactEmail: "hello@vendor.example" },
        })
      )
    ).toBe(1)
    expect(fallback.messages[0]?.to).toBe("hello@vendor.example")
  })

  it("TC-E8S1-64: the reason reaches the email", async () => {
    const queue = new RecordingTransactionalQueue()

    await notifyVendorTransition(
      fakeTx([{ name: "Olive", email: "olive@example.com" }]),
      queue,
      notice({ action: "reject", reason: "No trading licence" })
    )

    expect(queue.messages[0]?.text).toContain("Reason: No trading licence")
  })

  it("TC-E8S1-65: two owners each get exactly one email, with their own job id", async () => {
    const queue = new RecordingTransactionalQueue()
    const tx = fakeTx([
      { name: "Olive", email: "olive@example.com" },
      { name: "Otto", email: "otto@example.com" },
    ])

    expect(await notifyVendorTransition(tx, queue, notice())).toBe(2)
    expect(queue.messages.map((m) => m.to).sort()).toEqual([
      "olive@example.com",
      "otto@example.com",
    ])
    expect(queue.jobs.size).toBe(2)
  })
})
