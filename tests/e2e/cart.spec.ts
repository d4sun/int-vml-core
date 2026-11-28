import {
  createListingWithStatus,
  addOpenSlot,
  createVendorFor,
  setVendorOnboarded,
} from "./db"
import { createVerifiedUser, expect, signInAndWait, test } from "./support"
import { randomUUID } from "node:crypto"

test("E2E-S1-05: a visitor holds a time from a listing page, sees the cart with its total, and can remove it", async ({
  page,
  request,
}) => {
  const vendorUser = await createVerifiedUser(request)
  const vendor = await createVendorFor(vendorUser.email, "APPROVED")
  await setVendorOnboarded(vendor.id)
  const title = `E2E Cart Walk ${randomUUID().slice(0, 8)}`
  const listing = await createListingWithStatus(vendor.id, title, "PUBLISHED")
  // Seven days ahead, so it is well past the product's booking cutoff.
  await addOpenSlot(listing.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))

  const visitor = await createVerifiedUser(request)
  await signInAndWait(page, visitor.email, visitor.password)

  await page.goto(`/listings/${listing.slug}`)
  await page.getByRole("button", { name: "Add to cart" }).click()
  await expect(page.getByRole("status")).toContainText("Added.")

  await page.goto("/cart")
  await expect(page.getByRole("link", { name: title })).toBeVisible()
  await expect(page.getByText("Total £15.00", { exact: true })).toBeVisible()
  await expect(page.getByText(/Places held for/)).toBeVisible()

  await page.getByRole("button", { name: "Remove" }).click()
  await expect(page.getByText("Your cart is empty.")).toBeVisible()
})
