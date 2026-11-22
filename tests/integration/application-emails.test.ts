import type { PlatformRole, PrismaClient } from "@prisma/client"
import type { PgBoss } from "pg-boss"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import type { SessionSource } from "@/lib/auth/guards"
import type { TransactionalEmailQueue } from "@/lib/email/transactional-queue"
import { ConflictError } from "@/lib/errors"
import { startBoss } from "@/lib/jobs/boss"
import { PgBossEmailQueue } from "@/lib/jobs/email-queue"
import { silentJobLogger } from "@/lib/jobs/logger"
import { QUEUES } from "@/lib/jobs/queues"
import { ensureQueues, registerWorkers } from "@/lib/jobs/register"
import { applyAsVendor } from "@/lib/services/vendor-application"
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

async function account(platformRole: PlatformRole, name: string) {
  const { email, password } = await h.registerVerified()
  const row = await prisma.user.update({
    where: { email },
    data: { platformRole, name },
  })

  return { id: row.id, email, session: await h.sessionFor(email, password) }
}

const deps = (session: SessionSource, q: TransactionalEmailQueue = queue) =>
  governanceDeps(session, prisma, q)

describe("admin application emails on Postgres (CR-7)", () => {
  it("TC-E4S1-59: applying emails exactly the administrators, once each, with a link to the review page", async () => {
    const ada = await account("ADMIN", "Ada")
    await account("VENDOR", "Vera")
    await account("TOURIST", "Tom")
    const olive = await account("TOURIST", "Olive Owner")

    const applied = await applyAsVendor(
      { name: "Thames Tours", description: "Walking tours." },
      deps(olive.session)
    )

    const rows = await jobs()

    expect(rows).toHaveLength(1)
    expect(rows[0]?.data).toMatchObject({
      to: ada.email,
      tags: { kind: "vendor-application" },
    })
    expect(rows[0]?.data.text).toContain("Thames Tours")
    expect(rows[0]?.data.text).toContain("Olive Owner")
    expect(rows[0]?.data.text).toContain(olive.email)
    expect(rows[0]?.data.text).toContain("Walking tours.")
    expect(rows[0]?.data.text).toContain(`/admin/vendors/${applied.id}`)
  })

  it("TC-E4S1-60: with two administrators each gets one email, with distinct job ids", async () => {
    const a = await account("ADMIN", "Ada")
    const b = await account("ADMIN", "Bo")
    const olive = await account("TOURIST", "Olive")

    await applyAsVendor({ name: "Thames Tours" }, deps(olive.session))

    const rows = await jobs()

    expect(rows.map((r) => r.data.to).sort()).toEqual([a.email, b.email].sort())
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)
  })

  it("TC-E4S1-61: a refused second application sends nothing", async () => {
    await account("ADMIN", "Ada")
    const olive = await account("TOURIST", "Olive")

    await applyAsVendor({ name: "Thames Tours" }, deps(olive.session))
    await expect(
      applyAsVendor({ name: "Another" }, deps(olive.session))
    ).rejects.toBeInstanceOf(ConflictError)

    expect(await jobs()).toHaveLength(1)
  })

  it("TC-E4S1-62: the email is part of the application's transaction: if it rolls back after the job was inserted, nothing remains", async () => {
    await account("ADMIN", "Ada")
    const olive = await account("TOURIST", "Olive")

    const failsAfterInsert: TransactionalEmailQueue = {
      async enqueueInTransaction(tx, message, id) {
        await queue.enqueueInTransaction(tx, message, id)

        throw new Error("something failed after the job was inserted")
      },
    }

    await expect(
      applyAsVendor(
        { name: "Thames Tours" },
        deps(olive.session, failsAfterInsert)
      )
    ).rejects.toThrow("after the job was inserted")

    expect(await jobs()).toHaveLength(0)
    expect(await prisma.vendor.count()).toBe(0)
    expect(await prisma.vendorMember.count()).toBe(0)
    expect(await prisma.auditLog.count()).toBe(0)
  })

  it("TC-E4S1-63: if the email cannot be queued the application is not created (no silent unannounced application)", async () => {
    await account("ADMIN", "Ada")
    const olive = await account("TOURIST", "Olive")
    const broken: TransactionalEmailQueue = {
      async enqueueInTransaction() {
        throw new Error("queue unavailable")
      },
    }

    await expect(
      applyAsVendor({ name: "Thames Tours" }, deps(olive.session, broken))
    ).rejects.toThrow("queue unavailable")

    expect(await prisma.vendor.count()).toBe(0)
    expect(await jobs()).toHaveLength(0)
  })

  it("TC-E4S1-64: with no administrator the application still stands (it shows in the queue) and nothing is queued", async () => {
    const olive = await account("TOURIST", "Olive")

    const applied = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )

    expect(applied.status).toBe("PENDING")
    expect(await prisma.vendor.count()).toBe(1)
    expect(await jobs()).toHaveLength(0)
  })

  it("TC-E4S1-65: a double submit creates one application and one set of emails", async () => {
    const ada = await account("ADMIN", "Ada")
    const olive = await account("TOURIST", "Olive")

    const results = await Promise.allSettled([
      applyAsVendor({ name: "Thames Tours" }, deps(olive.session)),
      applyAsVendor({ name: "Thames Tours" }, deps(olive.session)),
    ])

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    const rows = await jobs()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.data.to).toBe(ada.email)
  })

  it("TC-E4S1-66: reapplying after a rejection emails the admins again, as a new application", async () => {
    const ada = await account("ADMIN", "Ada")
    const olive = await account("TOURIST", "Olive")

    const first = await applyAsVendor(
      { name: "Thames Tours" },
      deps(olive.session)
    )
    await transitionVendor(
      { vendorId: first.id, action: "reject", reason: "No licence" },
      deps(ada.session)
    )
    await applyAsVendor({ name: "Thames Tours" }, deps(olive.session))

    const kinds = (await jobs()).map((r) => r.data.tags?.kind)

    expect(kinds).toEqual([
      "vendor-application",
      "vendor-rejected",
      "vendor-application",
    ])
  })

  it("TC-E4S1-67: the queued email is really delivered to the administrator by the worker, once", async () => {
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

      const ada = await account("ADMIN", "Ada")
      const olive = await account("TOURIST", "Olive")

      await applyAsVendor({ name: "Thames Tours" }, deps(olive.session))
      await waitFor(() => sender.messages.length >= 1, {
        label: "application email delivered",
      })

      expect(sender.messages).toHaveLength(1)
      expect(sender.messages[0]).toMatchObject({
        to: ada.email,
        tags: { kind: "vendor-application" },
      })
    } finally {
      await worker.stop({ graceful: true, close: true })
    }
  })
})
