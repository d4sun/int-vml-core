import type { PlatformRole, PrismaClient, VendorStatus } from "@prisma/client"
import type { PgBoss } from "pg-boss"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import { ConflictError, ForbiddenError } from "@/lib/errors"
import { startBoss } from "@/lib/jobs/boss"
import { PgBossEmailQueue } from "@/lib/jobs/email-queue"
import { silentJobLogger } from "@/lib/jobs/logger"
import { ensureQueues, registerWorkers } from "@/lib/jobs/register"
import { QUEUES } from "@/lib/jobs/queues"
import { emailJobId } from "@/lib/services/vendor-notifications"
import { transitionVendor } from "@/lib/services/vendor-governance"
import {
  createTestPrismaClient,
  plainJobsUrl,
  truncatePublicSchema,
} from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"
import { governanceDeps } from "../helpers/recording-transactional-queue"
import { RecordingEmailSender } from "../helpers/recording-sender"
import { waitFor } from "../helpers/wait-for"

let prisma: PrismaClient
let boss: PgBoss
let h: AuthHarness
let queue: PgBossEmailQueue

beforeAll(async () => {
  prisma = createTestPrismaClient()
  boss = await startBoss({
    connectionString: plainJobsUrl(),
    logger: silentJobLogger,
  })
  await ensureQueues(boss)
  queue = new PgBossEmailQueue(boss)
})

afterAll(async () => {
  await boss.stop({ graceful: true, close: true })
  await prisma.$disconnect()
})

beforeEach(async () => {
  await truncatePublicSchema(prisma)
  await prisma.$executeRawUnsafe(
    `DELETE FROM pgboss.job WHERE name = '${QUEUES.emailSend}'`
  )
  h = makeHarness({ database: prismaAuthDatabase(prisma) })
})

type JobRow = {
  id: string
  data: { to: string; subject: string; text?: string; tags?: { kind?: string } }
}

const jobs = () =>
  prisma.$queryRawUnsafe<JobRow[]>(
    `SELECT id, data FROM pgboss.job WHERE name = '${QUEUES.emailSend}' ORDER BY created_on, id`
  )

async function admin() {
  return account("ADMIN", "Admin")
}

async function account(platformRole: PlatformRole, name: string) {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole, name },
  })

  return { id: row.id, email, session: await h.sessionFor(email, password) }
}

let counter = 0
async function vendorWithOwner(status: VendorStatus = "PENDING") {
  counter += 1
  const owner = await account("VENDOR", `Olive ${counter}`)
  const vendor = await prisma.vendor.create({
    data: {
      name: `Vendor ${counter}`,
      slug: `vendor-${counter}-${Date.now()}`,
      status,
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
  })

  return { vendor, owner }
}

const deps = (
  session: Parameters<typeof governanceDeps>[0],
  q: TransactionalEmailQueue = queue
) => governanceDeps(session, prisma, q)

describe("vendor status emails on Postgres (CR-7)", () => {
  it("TC-E8S1-66: approving a vendor enqueues exactly one email, for its owner, with a deterministic job id", async () => {
    const a = await admin()
    const { vendor, owner } = await vendorWithOwner("PENDING")

    await transitionVendor(
      { vendorId: vendor.id, action: "approve" },
      deps(a.session)
    )

    const rows = await jobs()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.data).toMatchObject({
      to: owner.email,
      tags: { kind: "vendor-approved" },
    })
    expect(rows[0]?.data.text).toContain(vendor.name)

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: vendor.id },
    })
    expect(rows[0]?.id).toBe(emailJobId(audit.id, owner.email))
  })

  it("TC-E8S1-67: every transition emails once: approve, suspend, reinstate and reject each produce one job of the right kind", async () => {
    const a = await admin()
    const first = await vendorWithOwner("PENDING")
    const second = await vendorWithOwner("PENDING")

    await transitionVendor(
      { vendorId: first.vendor.id, action: "approve" },
      deps(a.session)
    )
    await transitionVendor(
      {
        vendorId: first.vendor.id,
        action: "suspend",
        reason: "Chargeback spike",
      },
      deps(a.session)
    )
    await transitionVendor(
      { vendorId: first.vendor.id, action: "reinstate" },
      deps(a.session)
    )
    await transitionVendor(
      {
        vendorId: second.vendor.id,
        action: "reject",
        reason: "No trading licence",
      },
      deps(a.session)
    )

    const rows = await jobs()

    expect(rows.map((r) => r.data.tags?.kind)).toEqual([
      "vendor-approved",
      "vendor-suspended",
      "vendor-reinstated",
      "vendor-rejected",
    ])
    expect(rows[1]?.data.text).toContain("Reason: Chargeback spike")
    expect(rows[3]?.data.to).toBe(second.owner.email)
    expect(new Set(rows.map((r) => r.id)).size).toBe(4)
  })

  it("TC-E8S1-68: an illegal transition changes nothing and sends nothing", async () => {
    const a = await admin()
    const { vendor } = await vendorWithOwner("APPROVED")

    await expect(
      transitionVendor(
        { vendorId: vendor.id, action: "approve" },
        deps(a.session)
      )
    ).rejects.toBeInstanceOf(ConflictError)

    expect(await jobs()).toHaveLength(0)
  })

  it("TC-E8S1-69: the email is part of the transaction: if the change rolls back after the job was inserted, no job remains", async () => {
    const a = await admin()
    const { vendor } = await vendorWithOwner("PENDING")

    const failsAfterInsert: TransactionalEmailQueue = {
      async enqueueInTransaction(tx, message, id) {
        await queue.enqueueInTransaction(tx, message, id)

        throw new Error("something failed after the job was inserted")
      },
    }

    await expect(
      transitionVendor(
        { vendorId: vendor.id, action: "approve" },
        deps(a.session, failsAfterInsert)
      )
    ).rejects.toThrow("after the job was inserted")

    expect(await jobs()).toHaveLength(0)
    expect(
      (await prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id } }))
        .status
    ).toBe("PENDING")
    expect(await prisma.auditLog.count()).toBe(0)
  })

  it("TC-E8S1-70: if the email cannot be queued, the status does not change either (no silent un-notified approval)", async () => {
    const a = await admin()
    const { vendor } = await vendorWithOwner("PENDING")

    const broken: TransactionalEmailQueue = {
      async enqueueInTransaction() {
        throw new Error("queue unavailable")
      },
    }

    await expect(
      transitionVendor(
        { vendorId: vendor.id, action: "approve" },
        deps(a.session, broken)
      )
    ).rejects.toThrow("queue unavailable")

    expect(
      (await prisma.vendor.findUniqueOrThrow({ where: { id: vendor.id } }))
        .status
    ).toBe("PENDING")
    expect(await prisma.auditLog.count()).toBe(0)
    expect(await jobs()).toHaveLength(0)
  })

  it("TC-E8S1-71: a non-admin cannot trigger an email", async () => {
    const { vendor, owner } = await vendorWithOwner("PENDING")

    await expect(
      transitionVendor(
        { vendorId: vendor.id, action: "approve" },
        deps(owner.session)
      )
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(await jobs()).toHaveLength(0)
  })

  it("TC-E8S1-72: enqueuing the same id twice creates one job, so a replay cannot send a second email", async () => {
    const message = {
      to: "olive@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
    }
    const id = emailJobId("audit-x", "olive@example.com")

    const outcomes = [
      await prisma.$transaction((tx) =>
        queue.enqueueInTransaction(tx, message, id)
      ),
      await prisma.$transaction((tx) =>
        queue.enqueueInTransaction(tx, message, id)
      ),
    ]

    expect(outcomes).toEqual([true, false])
    expect(await jobs()).toHaveLength(1)
  })

  it("TC-E8S1-73: two admins racing on one pending vendor produce exactly one email in total", async () => {
    const a = await admin()
    const b = await admin()
    const { vendor } = await vendorWithOwner("PENDING")

    const results = await Promise.allSettled([
      transitionVendor(
        { vendorId: vendor.id, action: "approve" },
        deps(a.session)
      ),
      transitionVendor(
        { vendorId: vendor.id, action: "reject", reason: "Duplicate" },
        deps(b.session)
      ),
    ])

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(await jobs()).toHaveLength(1)
  })

  it("TC-E8S1-74: the queued email is really delivered by the worker, once", async () => {
    const worker = await startBoss({
      connectionString: plainJobsUrl(),
      supervise: true,
      logger: silentJobLogger,
    })
    const sender = new RecordingEmailSender()

    try {
      await ensureQueues(worker)
      await registerWorkers(worker, {
        emailSender: sender,
        logger: silentJobLogger,
      })

      const a = await admin()
      const { vendor, owner } = await vendorWithOwner("PENDING")

      await transitionVendor(
        { vendorId: vendor.id, action: "approve" },
        deps(a.session)
      )

      await waitFor(() => sender.messages.length >= 1, {
        label: "vendor email delivered",
      })

      expect(sender.messages).toHaveLength(1)
      expect(sender.messages[0]).toMatchObject({
        to: owner.email,
        tags: { kind: "vendor-approved" },
      })
    } finally {
      await worker.stop({ graceful: true, close: true })
    }
  })
})
