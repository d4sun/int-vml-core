import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import {
  extractLink,
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

async function registerAndVerify(email: string) {
  await h.signUp({ name: "Ada Lovelace", email, password: VALID_PASSWORD })

  return h.follow(extractLink(h.emails("verification")[0]!))
}

describe("Better Auth identity on Postgres", () => {
  it("TC-E0S1-12: registration persists an unverified TOURIST with a hashed credential", async () => {
    const email = uniqueEmail()

    const response = await h.signUp({
      name: "Ada Lovelace",
      email,
      password: VALID_PASSWORD,
    })
    expect(response.status).toBe(200)

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { accounts: true, sessions: true },
    })

    expect(user).toMatchObject({
      name: "Ada Lovelace",
      emailVerified: false,
      platformRole: "TOURIST",
    })
    expect(user.sessions).toHaveLength(0)
    expect(user.accounts).toHaveLength(1)
    expect(user.accounts[0]?.providerId).toBe("credential")
    expect(user.accounts[0]?.password).toBeTruthy()
    expect(user.accounts[0]?.password).not.toContain(VALID_PASSWORD)
  })

  it("TC-E0S1-13: duplicate registration leaves exactly one user and one account", async () => {
    const email = uniqueEmail()

    await h.signUp({ name: "Ada", email, password: VALID_PASSWORD })
    const second = await h.signUp({
      name: "Ada",
      email,
      password: VALID_PASSWORD,
    })

    expect(second.status).toBe(200)
    expect(await prisma.user.count({ where: { email } })).toBe(1)
    expect(await prisma.account.count()).toBe(1)
  })

  it("TC-E0S1-14: verifying the email marks the user verified and creates a session", async () => {
    const email = uniqueEmail()

    const response = await registerAndVerify(email)
    expect(response.status).toBeLessThan(400)

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { sessions: true },
    })

    expect(user.emailVerified).toBe(true)
    expect(user.sessions).toHaveLength(1)
    expect(user.sessions[0]?.token).toBeTruthy()
  })

  it("TC-E0S1-15: deleting a user cascades to sessions and accounts", async () => {
    const email = uniqueEmail()
    await registerAndVerify(email)

    await prisma.user.delete({ where: { email } })

    expect(await prisma.session.count()).toBe(0)
    expect(await prisma.account.count()).toBe(0)
  })

  it("TC-E0S1-16: a client-supplied platformRole never reaches the database", async () => {
    const email = uniqueEmail()

    await h.signUp({
      name: "Mallory",
      email,
      password: VALID_PASSWORD,
      platformRole: "ADMIN",
    })

    const user = await prisma.user.findUnique({ where: { email } })
    expect(user?.platformRole ?? "TOURIST").toBe("TOURIST")
  })

  it("TC-E0S1-29: opening the verification link twice leaves one session and a verified user", async () => {
    const email = uniqueEmail()

    await h.signUp({ name: "Ada", email, password: VALID_PASSWORD })
    const link = extractLink(h.emails("verification")[0]!)

    await h.follow(link)
    await h.follow(link)

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { sessions: true },
    })

    expect(user.emailVerified).toBe(true)
    expect(user.sessions).toHaveLength(1)
  })

  it("TC-E0S1-30: a resent link verifies the user and redirects to the completion page", async () => {
    const email = uniqueEmail()

    await h.signUp({ name: "Ada", email, password: VALID_PASSWORD })
    await h.request("/send-verification-email", { body: { email } })

    const [, resent] = h.emails("verification")
    const response = await h.follow(extractLink(resent!))

    const target = new URL(
      response.headers.get("location") ?? "",
      "http://localhost:3000"
    )
    expect(target.pathname).toBe("/verify-email/complete")
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerified
    ).toBe(true)
  })
})
