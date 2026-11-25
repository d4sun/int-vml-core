import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  RESERVED_CATEGORY_SLUGS,
  SLUG_PATTERN,
  categorySlug,
} from "@/lib/categories/slug"

const root = fileURLToPath(new URL("../..", import.meta.url))

describe("categorySlug", () => {
  it.each([
    ["Tours", "tours"],
    ["  Food & Drink  ", "food-drink"],
    ["Café Culture", "cafe-culture"],
    ["Kids' Activities (6-12)", "kids-activities-6-12"],
    ["a---b", "a-b"],
    ["---", ""],
    ["🙂🙂", ""],
    ["", ""],
  ])("%j becomes %j", (name, slug) => {
    expect(categorySlug(name)).toBe(slug)
  })

  it("cuts long names without leaving a trailing hyphen", () => {
    const slug = categorySlug(`${"word ".repeat(30)}`)

    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith("-")).toBe(false)
    expect(SLUG_PATTERN.test(slug)).toBe(true)
  })

  it("everything it returns matches the slug pattern", () => {
    for (const name of ["Tours", "Food & Drink", "Café", "1 2 3", "x"]) {
      expect(SLUG_PATTERN.test(categorySlug(name))).toBe(true)
    }
  })
})

describe("SLUG_PATTERN", () => {
  it.each(["tours", "food-drink", "a1", "6-12"])("accepts %s", (slug) => {
    expect(SLUG_PATTERN.test(slug)).toBe(true)
  })

  it.each(["", "Tours", "-a", "a-", "a--b", "a b", "a_b", "é", "a/b", ".."])(
    "rejects %j",
    (slug) => {
      expect(SLUG_PATTERN.test(slug)).toBe(false)
    }
  )
})

/**
 * Tripwire: a category slug is a top-level URL, so every static route
 * segment directly under `app/` must be reserved. Route groups `(x)` are
 * transparent; dynamic segments `[x]` are not reserved names.
 */
function topLevelSegments(dir: string): string[] {
  const segments: string[] = []

  for (const name of readdirSync(dir)) {
    const full = join(dir, name)

    if (!statSync(full).isDirectory()) continue

    if (name.startsWith("(")) segments.push(...topLevelSegments(full))
    else if (!name.startsWith("[") && !name.startsWith("_")) {
      segments.push(name)
    }
  }

  return segments
}

describe("reserved category slugs", () => {
  it("cover every top-level route of the app", () => {
    const segments = topLevelSegments(join(root, "app"))

    expect(segments.length).toBeGreaterThan(8)

    const missing = segments.filter((s) => !RESERVED_CATEGORY_SLUGS.has(s))

    expect(missing).toEqual([])
  })

  it("only hold values that could be slugs", () => {
    for (const slug of RESERVED_CATEGORY_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9_-]+$/)
    }
  })
})
