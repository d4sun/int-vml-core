import { randomUUID } from "node:crypto"
import type { Page } from "@playwright/test"
import {
  SEED,
  SEED_PASSWORD,
  createVerifiedUser,
  expect,
  signInAndWait,
  test,
} from "./support"

const unique = () => randomUUID().slice(0, 6)
const row = (page: Page, slug: string) =>
  page.locator(`[data-testid="category-tree"] li[data-slug="${slug}"]`)

async function asAdmin(page: Page) {
  await signInAndWait(page, SEED.admin, SEED_PASSWORD)
  await page.goto("/admin/categories")
}

async function add(
  page: Page,
  name: string,
  options: { slug?: string; parent?: string; commission?: string } = {}
) {
  await page.getByLabel("Name").first().fill(name)
  if (options.slug) await page.getByLabel("Slug").first().fill(options.slug)
  if (options.parent) {
    await page.getByLabel("Parent category").first().selectOption({
      label: options.parent,
    })
  }
  if (options.commission) {
    await page
      .getByLabel("Default commission (%)")
      .first()
      .fill(options.commission)
  }
  await page.getByRole("button", { name: "Add category" }).click()
}

test("E2E-S9-01: an admin adds a category and a sub-category, edits the commission, and deletes the empty one", async ({
  page,
}) => {
  const id = unique()
  const name = `Kayak ${id}`
  const slug = `kayak-${id}`

  await asAdmin(page)

  // The seeded taxonomy is there.
  await expect(row(page, "tours")).toBeVisible()
  await expect(row(page, "tours")).toContainText("10% commission")

  await add(page, name, { commission: "12.5" })
  await expect(row(page, slug)).toBeVisible()
  await expect(row(page, slug)).toContainText("12.5% commission")

  await add(page, `Sub ${id}`, { parent: name })
  await expect(row(page, `sub-${id}`)).toBeVisible()

  // Edit the parent's commission.
  await page.getByRole("link", { name: `Edit ${name}` }).click()
  const edit = page.getByTestId("category-edit")
  await edit.getByLabel("Default commission (%)").fill("15")
  await edit.getByRole("button", { name: "Save changes" }).click()
  await expect(edit.getByText("Saved.")).toBeVisible()
  await expect(row(page, slug)).toContainText("15% commission")

  // It has a sub-category, so it cannot be deleted.
  await edit.getByRole("button", { name: "Delete category" }).click()
  await expect(edit.getByRole("alert")).toContainText("sub-categories")
  await expect(row(page, slug)).toBeVisible()

  // The empty child can.
  await page.goto("/admin/categories")
  await page.getByRole("link", { name: `Edit Sub ${id}` }).click()
  await page
    .getByTestId("category-edit")
    .getByRole("button", { name: "Delete category" })
    .click()
  await expect(row(page, `sub-${id}`)).toHaveCount(0)
})

test("E2E-S9-02: a category with listings cannot be deleted, and a move into its own subtree is refused", async ({
  page,
}) => {
  const id = unique()

  await asAdmin(page)

  // The seeded Tours category has the seeded listing.
  await expect(row(page, "tours")).toContainText("1 listing")
  await page.getByRole("link", { name: "Edit Tours" }).click()
  await page
    .getByTestId("category-edit")
    .getByRole("button", { name: "Delete category" })
    .click()
  await expect(
    page.getByTestId("category-edit").getByRole("alert")
  ).toContainText("has listings")
  await expect(row(page, "tours")).toBeVisible()

  // A cycle cannot even be chosen: the edit form hides the category's own
  // subtree, and the server would refuse it anyway.
  await page.goto("/admin/categories")
  await add(page, `Top ${id}`)
  await add(page, `Child ${id}`, { parent: `Top ${id}` })
  await page.getByRole("link", { name: `Edit Top ${id}` }).click()

  const edit = page.getByTestId("category-edit")

  await expect(edit).toBeVisible()

  const select = edit.getByLabel("Parent category")

  // Other categories are offered (so the list has really loaded)...
  await expect(select.locator("option", { hasText: "Tours" })).toHaveCount(1)

  const options = await select.locator("option").allTextContents()

  // ...but never the category itself or anything beneath it.
  expect(options.length).toBeGreaterThan(2)
  expect(options.some((o) => o.includes(`Top ${id}`))).toBe(false)
  expect(options.some((o) => o.includes(`Child ${id}`))).toBe(false)
})

test("E2E-S9-03: bad input is explained next to the field and nothing is created", async ({
  page,
}) => {
  const id = unique()

  await asAdmin(page)
  await add(page, `Bad ${id}`, { commission: "12.345" })
  await expect(page.getByText("Enter a number")).toBeVisible()
  await expect(row(page, `bad-${id}`)).toHaveCount(0)

  await add(page, `Admin ${id}`, { slug: "admin" })
  await expect(
    page.getByText("That slug is used by a page of the site")
  ).toBeVisible()

  await add(page, "Tours")
  await expect(
    page.getByText("Another category already uses that slug")
  ).toBeVisible()
})

test("E2E-S9-04: only an admin can open the editor", async ({
  page,
  request,
}) => {
  const visitor = await page.goto("/admin/categories")

  expect(visitor?.url()).toContain("/sign-in")

  const { email, password } = await createVerifiedUser(request)

  await signInAndWait(page, email, password)

  const response = await page.goto("/admin/categories")

  expect(response?.status()).toBe(404)
})
