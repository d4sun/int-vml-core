import { describe, expect, it, vi } from "vitest"
import { PgBossEmailQueue } from "@/lib/jobs/email-queue"
import { prismaTransactionDb } from "@/lib/jobs/prisma-db"

const message = {
  to: "olive@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
}

describe("prismaTransactionDb", () => {
  it("TC-E8S1-75: runs pg-boss SQL through the given transaction, passing the parameters through", async () => {
    const tx = { $queryRawUnsafe: vi.fn(async () => [{ id: "job-1" }]) }

    const result = await prismaTransactionDb(tx as never).executeSql(
      "INSERT ... $1 $2",
      ["a", 2]
    )

    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith("INSERT ... $1 $2", "a", 2)
    expect(result).toEqual({ rows: [{ id: "job-1" }] })
  })

  it("TC-E8S1-76: with no parameters it still works", async () => {
    const tx = { $queryRawUnsafe: vi.fn(async () => []) }

    await prismaTransactionDb(tx as never).executeSql("SELECT 1")

    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith("SELECT 1")
  })
})

describe("PgBossEmailQueue.enqueueInTransaction", () => {
  function fakeBoss(returns: string | null) {
    const calls: Array<{
      name: string
      data: unknown
      options: Record<string, unknown>
    }> = []

    return {
      calls,
      boss: {
        send: async (
          name: string,
          data: unknown,
          options: Record<string, unknown>
        ) => {
          calls.push({ name, data, options })

          return returns
        },
      },
    }
  }

  it("TC-E8S1-77: sends the job with the given id and a db that runs inside the transaction", async () => {
    const { boss, calls } = fakeBoss("job-1")
    const tx = { $queryRawUnsafe: vi.fn(async () => [{ id: "job-1" }]) }

    const created = await new PgBossEmailQueue(
      boss as never
    ).enqueueInTransaction(
      tx as never,
      message,
      "11111111-1111-5111-8111-111111111111"
    )

    expect(created).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("email.send")
    expect(calls[0]?.options.id).toBe("11111111-1111-5111-8111-111111111111")
    expect(calls[0]?.options.retryLimit).toBe(5)

    // The db handed to pg-boss is backed by *this* transaction.
    const db = calls[0]?.options.db as {
      executeSql(t: string, v?: unknown[]): Promise<unknown>
    }
    await db.executeSql("SELECT 42", [])
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith("SELECT 42")
  })

  it("TC-E8S1-78: a null result (id already existed) means nothing was created", async () => {
    const { boss } = fakeBoss(null)

    expect(
      await new PgBossEmailQueue(boss as never).enqueueInTransaction(
        { $queryRawUnsafe: vi.fn() } as never,
        message,
        "11111111-1111-5111-8111-111111111111"
      )
    ).toBe(false)
  })

  it("TC-E8S1-79: an invalid message is refused before anything is sent", async () => {
    const { boss, calls } = fakeBoss("job-1")

    await expect(
      new PgBossEmailQueue(boss as never).enqueueInTransaction(
        { $queryRawUnsafe: vi.fn() } as never,
        { ...message, to: "not-an-email" },
        "11111111-1111-5111-8111-111111111111"
      )
    ).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})
