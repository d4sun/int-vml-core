import { describe, expect, it } from "vitest"
import type { SessionSource } from "@/lib/auth/guards"
import { ValidationError } from "@/lib/errors"
import {
  getProfile,
  updateProfile,
  type Profile,
  type ProfileStore,
} from "@/lib/services/profile"

function makeWorld() {
  const rows = new Map<string, Profile>([
    [
      "A",
      {
        id: "A",
        name: "Alice",
        email: "alice@example.com",
        emailVerified: true,
        image: null,
        platformRole: "TOURIST",
      },
    ],
    [
      "B",
      {
        id: "B",
        name: "Bob",
        email: "bob@example.com",
        emailVerified: true,
        image: null,
        platformRole: "TOURIST",
      },
    ],
  ])

  const writes: Array<{ id: string; name: string }> = []

  const store: ProfileStore = {
    async findById(id) {
      return rows.get(id) ?? null
    },
    async updateName(id, name) {
      writes.push({ id, name })
      const row = rows.get(id)

      if (!row) return null

      const next = { ...row, name }
      rows.set(id, next)

      return next
    },
  }

  const as =
    (id: string | null): SessionSource =>
    async () => {
      const row = id ? rows.get(id) : undefined

      return row
        ? {
            user: {
              id: row.id,
              email: row.email,
              name: row.name,
              emailVerified: row.emailVerified,
              platformRole: row.platformRole,
            },
          }
        : null
    }

  return { rows, writes, store, as }
}

describe("getProfile", () => {
  it("TC-E0S2-46: returns only the caller's own profile", async () => {
    const w = makeWorld()

    const profile = await getProfile({ session: w.as("A"), store: w.store })

    expect(profile).toMatchObject({ id: "A", email: "alice@example.com" })
  })

  it("TC-E0S2-47: no session is rejected before any read", async () => {
    const w = makeWorld()

    await expect(
      getProfile({ session: w.as(null), store: w.store })
    ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" })
  })

  it("TC-E0S2-48: a session whose user row no longer exists is a not-found", async () => {
    const w = makeWorld()
    w.rows.delete("A")

    await expect(
      getProfile({
        session: async () => ({
          user: {
            id: "A",
            email: "alice@example.com",
            name: "Alice",
            emailVerified: true,
          },
        }),
        store: w.store,
      })
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe("updateProfile", () => {
  it("TC-E0S2-49: updates the caller's own name, trimmed, and nobody else's", async () => {
    const w = makeWorld()

    const updated = await updateProfile(
      { name: "  Alice Liddell " },
      { session: w.as("A"), store: w.store }
    )

    expect(updated.name).toBe("Alice Liddell")
    expect(w.rows.get("A")?.name).toBe("Alice Liddell")
    expect(w.rows.get("B")?.name).toBe("Bob")
    expect(w.writes).toEqual([{ id: "A", name: "Alice Liddell" }])
  })

  it("TC-E0S2-04: user A cannot edit user B by naming B in the input", async () => {
    const w = makeWorld()

    for (const target of [
      { id: "B" },
      { userId: "B" },
      { email: "bob@example.com" },
    ]) {
      await expect(
        updateProfile(
          { name: "Hacked", ...target },
          { session: w.as("A"), store: w.store }
        )
      ).rejects.toBeInstanceOf(ValidationError)
    }

    expect(w.rows.get("B")?.name).toBe("Bob")
    expect(w.rows.get("A")?.name).toBe("Alice")
    expect(w.writes).toHaveLength(0)
  })

  it("TC-E0S2-05: a client-supplied platformRole is rejected and the role is unchanged", async () => {
    const w = makeWorld()

    await expect(
      updateProfile(
        { name: "Alice", platformRole: "ADMIN" },
        { session: w.as("A"), store: w.store }
      )
    ).rejects.toBeInstanceOf(ValidationError)

    expect(w.rows.get("A")?.platformRole).toBe("TOURIST")
    expect(w.writes).toHaveLength(0)
  })

  it("TC-E0S2-50: the write targets the session user even when the input is otherwise valid", async () => {
    const w = makeWorld()

    await updateProfile(
      { name: "Bobby" },
      { session: w.as("B"), store: w.store }
    )

    expect(w.rows.get("B")?.name).toBe("Bobby")
    expect(w.rows.get("A")?.name).toBe("Alice")
  })

  it("TC-E0S2-51: invalid names return field errors and write nothing", async () => {
    const w = makeWorld()

    for (const name of ["", "   ", "a".repeat(101)]) {
      const error = await updateProfile(
        { name },
        { session: w.as("A"), store: w.store }
      ).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ValidationError)
      expect(
        (error as ValidationError).fieldErrors?.name?.length
      ).toBeGreaterThan(0)
    }

    expect(w.writes).toHaveLength(0)
  })

  it("TC-E0S2-52: no session means nothing is read or written", async () => {
    const w = makeWorld()

    await expect(
      updateProfile({ name: "Nope" }, { session: w.as(null), store: w.store })
    ).rejects.toMatchObject({ status: 401 })
    expect(w.writes).toHaveLength(0)
  })

  it("TC-E0S2-53: non-object input is a validation error, not a crash", async () => {
    const w = makeWorld()

    for (const input of [null, undefined, "Alice", 42, ["Alice"]]) {
      await expect(
        updateProfile(input, { session: w.as("A"), store: w.store })
      ).rejects.toBeInstanceOf(ValidationError)
    }
  })
})
