import { describe, expect, it } from "vitest"
import { SEED_CATEGORIES } from "@/lib/categories/taxonomy"
import { createCategorySchema } from "@/lib/validation/category"

describe("seed taxonomy", () => {
  it("every entry is a valid category the service would accept", () => {
    for (const seed of SEED_CATEGORIES) {
      expect(createCategorySchema.safeParse(seed).success, seed.slug).toBe(true)
    }
  })

  it("names and slugs are unique", () => {
    expect(new Set(SEED_CATEGORIES.map((c) => c.slug)).size).toBe(
      SEED_CATEGORIES.length
    )
    expect(new Set(SEED_CATEGORIES.map((c) => c.name)).size).toBe(
      SEED_CATEGORIES.length
    )
  })

  it("includes tours (the seeded listing needs it) and events", () => {
    const slugs = SEED_CATEGORIES.map((c) => c.slug)

    expect(slugs).toContain("tours")
    expect(slugs).toContain("events")
  })
})
