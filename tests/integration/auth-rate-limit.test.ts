import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import {
  freshIp,
  makeHarness,
  uniqueEmail,
  VALID_PASSWORD,
  type AuthHarness,
} from "../helpers/auth-harness"

let prisma: PrismaClient
let h: AuthHarness

beforeAll(() => {
  prisma = createTestPrismaClient()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await truncatePublicSchema(prisma)
  h = makeHarness({ database: prismaAuthDatabase(prisma) })
})

function signUp(ip: string) {
  return h.signUp(
    { name: "Ada", email: uniqueEmail(), password: VALID_PASSWORD },
    ip
  )
}

describe("auth rate limits on Postgres", () => {
  it("TC-E0S1-42: sequential sign-ups are limited to 5 per minute per IP and persisted", async () => {
    const ip = freshIp()
    const statuses: number[] = []

    for (let i = 0; i < 6; i += 1) {
      statuses.push((await signUp(ip)).status)
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
    expect(await prisma.user.count()).toBe(5)

    const rows = await prisma.rateLimit.findMany({
      where: { key: { contains: "sign-up/email" } },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.count).toBe(5)
    expect(Number(rows[0]?.lastRequest)).toBeGreaterThan(0)
  })

  it("TC-E0S1-43: concurrent sign-ups from one IP cannot exceed the limit", async () => {
    const ip = freshIp()

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => signUp(ip))
    )
    const statuses = responses.map((response) => response.status)

    expect(statuses.filter((status) => status === 200)).toHaveLength(5)
    expect(statuses.filter((status) => status === 429)).toHaveLength(5)
    expect(await prisma.user.count()).toBe(5)
  })

  it("TC-E0S1-44: a different IP has its own bucket", async () => {
    const noisy = freshIp()

    for (let i = 0; i < 6; i += 1) await signUp(noisy)

    expect((await signUp(freshIp())).status).toBe(200)
  })
})
