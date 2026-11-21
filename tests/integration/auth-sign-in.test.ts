import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import {
  freshIp,
  makeHarness,
  sessionCookie,
  type AuthHarness,
} from "../helpers/auth-harness"

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

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

describe("sign-in on Postgres", () => {
  it("TC-E0S2-25: a sign-in stores a 7 day session that authenticates its cookie", async () => {
    const { email, password } = await h.registerVerified()
    const before = await prisma.session.count()

    const response = await h.signIn({ email, password }, freshIp())
    const cookie = sessionCookie(response)

    expect(response.status).toBe(200)
    expect(cookie).toBeTruthy()
    expect(await prisma.session.count()).toBe(before + 1)

    const row = await prisma.session.findFirstOrThrow({
      orderBy: { createdAt: "desc" },
    })
    const lifetime = row.expiresAt.getTime() - row.createdAt.getTime()

    expect(lifetime).toBeGreaterThan(SEVEN_DAYS_MS - 60_000)
    expect(lifetime).toBeLessThanOrEqual(SEVEN_DAYS_MS + 1000)

    const session = await h.auth.api.getSession({
      headers: new Headers({ cookie: cookie! }),
    })
    expect(session?.user.email).toBe(email)
  })

  it("TC-E0S2-26: concurrent guesses against one account never exceed the 10 attempt budget", async () => {
    const { email, password } = await h.registerVerified()

    const responses = await Promise.all(
      Array.from({ length: 15 }, () =>
        h.signIn({ email, password: "wrong-password-1" }, freshIp())
      )
    )
    const statuses = responses.map((response) => response.status)

    expect(
      statuses.filter((status) => status === 401).length
    ).toBeLessThanOrEqual(10)
    expect(
      statuses.filter((status) => status === 429).length
    ).toBeGreaterThanOrEqual(5)
    expect(statuses.every((status) => status === 401 || status === 429)).toBe(
      true
    )

    // Even the right password is refused while the account is locked.
    expect((await h.signIn({ email, password }, freshIp())).status).toBe(429)
  })

  it("TC-E0S2-27: attempts are stored as hashed identifiers, and a successful sign-in clears them", async () => {
    const { email, password } = await h.registerVerified()

    await h.signIn({ email, password: "wrong-password-1" }, freshIp())

    const rows = await prisma.verification.findMany({
      where: { identifier: { startsWith: "sign-in-account:" } },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.identifier).not.toContain(email)

    expect((await h.signIn({ email, password }, freshIp())).status).toBe(200)
    expect(
      await prisma.verification.count({
        where: { identifier: { startsWith: "sign-in-account:" } },
      })
    ).toBe(0)
  })
})
