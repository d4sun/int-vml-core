import { SEED, SEED_PASSWORD, expect, signInAndWait, test } from "./support"

test("E2E-S2-01: an admin reads the ledger, filters it by kind, and is refused a half-given date range", async ({
  page,
}) => {
  await signInAndWait(page, SEED.admin, SEED_PASSWORD)

  await page.goto("/admin/ledger")
  await expect(page.getByRole("heading", { name: "Ledger" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Movements" })).toBeVisible()

  await page.getByLabel("Kind").selectOption("refund")
  await page.getByRole("button", { name: "Apply" }).click()
  await expect(page).toHaveURL(/kind=refund/)
  await expect(page.getByRole("heading", { name: "Movements" })).toBeVisible()

  await page.goto("/admin/ledger?from=2026-11-01")
  await expect(page.getByText("Give both dates, or neither")).toBeVisible()
})
