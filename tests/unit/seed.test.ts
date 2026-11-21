import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_SEED_PASSWORD,
  SEED_USERS,
  assertSeedAllowed,
} from "../../prisma/seed-core"
import { emailSchema, passwordSchema } from "@/lib/validation/auth"

const run = promisify(execFile)

describe("seed safety", () => {
  it("TC-E0S3-32: seeding is refused in production and allowed elsewhere", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(
      /Refusing to seed/
    )

    for (const NODE_ENV of ["development", "test", undefined]) {
      expect(
        () => assertSeedAllowed({ NODE_ENV }),
        String(NODE_ENV)
      ).not.toThrow()
    }
  })

  it("TC-E0S3-33: the seed command itself refuses in production before touching the database", async () => {
    const result = await run("pnpm", ["exec", "tsx", "prisma/seed.ts"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://u:p@127.0.0.1:5999/x",
        DIRECT_URL: "postgresql://u:p@127.0.0.1:5999/x",
      },
    }).then(
      () => ({ code: 0, stderr: "" }),
      (error: { code?: number; stderr?: string }) => ({
        code: error.code ?? 1,
        stderr: error.stderr ?? "",
      })
    )

    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/Refusing to seed/)
    expect(result.stderr).not.toMatch(/PrismaClient/)
  }, 60_000)
})

describe("seed accounts", () => {
  it("TC-E0S3-34: there is one admin, one vendor owner, one staff member and one tourist", () => {
    expect(
      SEED_USERS.map((u) => [
        u.platformRole,
        "vendorRole" in u ? u.vendorRole : null,
      ])
    ).toEqual([
      ["ADMIN", null],
      ["VENDOR", "OWNER"],
      ["VENDOR", "STAFF"],
      ["TOURIST", null],
    ])
  })

  it("TC-E0S3-35: addresses are unique, valid and on the reserved .test domain, so they can never be real", () => {
    const emails = SEED_USERS.map((u) => u.email)

    expect(new Set(emails).size).toBe(emails.length)

    for (const email of emails) {
      expect(emailSchema.safeParse(email).success, email).toBe(true)
      expect(email.endsWith(".test"), email).toBe(true)
    }
  })

  it("TC-E0S3-36: the default password satisfies the app's own password policy", () => {
    expect(passwordSchema.safeParse(DEFAULT_SEED_PASSWORD).success).toBe(true)
  })
})
