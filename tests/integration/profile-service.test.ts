import type { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { prismaAuthDatabase } from "@/lib/auth/config"
import type { SessionSource } from "@/lib/auth/guards"
import { ValidationError } from "@/lib/errors"
import {
  getProfile,
  prismaProfileStore,
  updateProfile,
} from "@/lib/services/profile"
import { createTestPrismaClient, truncatePublicSchema } from "../helpers/db"
import { makeHarness, type AuthHarness } from "../helpers/auth-harness"

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

/** Signs a fresh verified user in and returns a real session source for them. */
async function userSession(name: string) {
  const { email, password } = await h.registerVerified()
  await prisma.user.update({ where: { email }, data: { name } })

  return { email, source: await h.sessionFor(email, password) }
}

const deps = (session: SessionSource) => ({
  session,
  store: prismaProfileStore(prisma),
})

describe("profile service on Postgres", () => {
  it("TC-E0S2-54: a signed-in user reads and renames only their own profile", async () => {
    const alice = await userSession("Alice")
    const bob = await userSession("Bob")

    expect((await getProfile(deps(alice.source))).email).toBe(alice.email)

    const updated = await updateProfile(
      { name: "  Alice Liddell " },
      deps(alice.source)
    )

    expect(updated.name).toBe("Alice Liddell")
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email: alice.email } }))
        .name
    ).toBe("Alice Liddell")
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email: bob.email } }))
        .name
    ).toBe("Bob")
  })

  it("TC-E0S2-55: naming another user, or a role, is rejected and nothing is written", async () => {
    const alice = await userSession("Alice")
    const bob = await userSession("Bob")
    const bobRow = await prisma.user.findUniqueOrThrow({
      where: { email: bob.email },
    })

    for (const extra of [
      { id: bobRow.id },
      { email: bob.email },
      { platformRole: "ADMIN" },
    ]) {
      await expect(
        updateProfile({ name: "Hacked", ...extra }, deps(alice.source))
      ).rejects.toBeInstanceOf(ValidationError)
    }

    const [aliceAfter, bobAfter] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: alice.email } }),
      prisma.user.findUniqueOrThrow({ where: { email: bob.email } }),
    ])

    expect(aliceAfter.name).toBe("Alice")
    expect(aliceAfter.platformRole).toBe("TOURIST")
    expect(bobAfter.name).toBe("Bob")
  })

  it("TC-E0S2-56: a revoked or missing session is rejected with 401", async () => {
    const alice = await userSession("Alice")
    await prisma.session.deleteMany()

    await expect(
      updateProfile({ name: "Late" }, deps(alice.source))
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" })
    await expect(getProfile(deps(async () => null))).rejects.toMatchObject({
      status: 401,
    })
  })

  it("TC-E0S2-57: the store changes the name column and nothing else", async () => {
    const alice = await userSession("Alice")
    const before = await prisma.user.findUniqueOrThrow({
      where: { email: alice.email },
    })

    await updateProfile({ name: "Alice Two" }, deps(alice.source))

    const after = await prisma.user.findUniqueOrThrow({
      where: { email: alice.email },
    })

    expect({ ...after, name: "", updatedAt: null }).toEqual({
      ...before,
      name: "",
      updatedAt: null,
    })
    expect(after.name).toBe("Alice Two")
  })
})
