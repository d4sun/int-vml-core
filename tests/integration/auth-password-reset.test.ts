import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import {
  extractLink,
  freshIp,
  makeHarness,
  type AuthHarness,
} from "../helpers/auth-harness"

const OLD_PASSWORD = "correct-horse-1"
const NEW_PASSWORD = "brand-new-pass-9"

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

async function requestToken(email: string): Promise<string> {
  await h.request("/request-password-reset", {
    body: { email },
    ip: freshIp(),
  })

  const link = extractLink(h.emails("password-reset").at(-1)!)

  return new URL(link).pathname.split("/").pop()!
}

describe("password reset on Postgres", () => {
  it("TC-E0S2-43: two concurrent resets with one token succeed exactly once", async () => {
    const { email } = await h.registerVerified({ password: OLD_PASSWORD })
    const token = await requestToken(email)

    const responses = await Promise.all([
      h.request("/reset-password", {
        body: { token, newPassword: "first-attempt-11" },
      }),
      h.request("/reset-password", {
        body: { token, newPassword: "second-attempt-22" },
      }),
    ])
    const statuses = responses.map((response) => response.status).sort()

    expect(statuses).toEqual([200, 400])
  })

  it("TC-E0S2-44: a reset rewrites the credential, revokes sessions and clears reset tokens", async () => {
    const { email } = await h.registerVerified({ password: OLD_PASSWORD })
    await h.signIn({ email, password: OLD_PASSWORD }, freshIp())
    await h.signIn({ email, password: OLD_PASSWORD }, freshIp())

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { accounts: true },
    })
    const oldHash = user.accounts[0]?.password
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(3)

    // Two outstanding links; using one must retire both.
    const first = await requestToken(email)
    await requestToken(email)

    expect(
      (
        await h.request("/reset-password", {
          body: { token: first, newPassword: NEW_PASSWORD },
        })
      ).status
    ).toBe(200)

    const after = await prisma.account.findFirstOrThrow({
      where: { userId: user.id },
    })

    expect(after.password).toBeTruthy()
    expect(after.password).not.toBe(oldHash)
    expect(after.password).not.toContain(NEW_PASSWORD)
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0)
    expect(
      await prisma.verification.count({
        where: { identifier: { startsWith: "reset-password:" } },
      })
    ).toBe(0)
  })

  it("TC-E0S2-45: signing in works with the new password only", async () => {
    const { email } = await h.registerVerified({ password: OLD_PASSWORD })
    const token = await requestToken(email)

    await h.request("/reset-password", {
      body: { token, newPassword: NEW_PASSWORD },
    })

    expect(
      (await h.signIn({ email, password: OLD_PASSWORD }, freshIp())).status
    ).toBe(401)
    expect(
      (await h.signIn({ email, password: NEW_PASSWORD }, freshIp())).status
    ).toBe(200)
  })
})
