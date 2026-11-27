import { createVendorFor, vendorCommission } from "./db"
import {
  SEED,
  SEED_PASSWORD,
  createVerifiedUser,
  expect,
  signInAndWait,
  test,
} from "./support"

test("E2E-S10-01: an admin sets a vendor's commission, the page shows it, and clearing it returns the category defaults", async ({
  page,
  request,
}) => {
  const { email } = await createVerifiedUser(request)
  const vendor = await createVendorFor(email, "APPROVED")

  await signInAndWait(page, SEED.admin, SEED_PASSWORD)
  await page.goto(`/admin/vendors/${vendor.id}`)

  const section = page.getByRole("region", { name: "Commission" })
  const box = section.getByLabel("Commission for this vendor (%)")

  await expect(
    section.getByText("Using each category's default commission.")
  ).toBeVisible()

  await box.fill("12.5")
  await section.getByRole("button", { name: "Save commission" }).click()

  await expect(section.getByRole("status")).toHaveText("Saved.")
  await expect(
    section.getByText("This vendor pays 12.5% on its sales")
  ).toBeVisible()
  expect(await vendorCommission(vendor.id)).toBe(1250)

  // Three decimal places are refused on the field and nothing changes.
  await box.fill("12.345")
  await section.getByRole("button", { name: "Save commission" }).click()
  await expect(section.getByText("Enter a number")).toBeVisible()
  expect(await vendorCommission(vendor.id)).toBe(1250)

  // A blank box clears the override.
  await box.fill("")
  await section.getByRole("button", { name: "Save commission" }).click()
  await expect(
    section.getByText("Using each category's default commission.")
  ).toBeVisible()
  expect(await vendorCommission(vendor.id)).toBeNull()
})
