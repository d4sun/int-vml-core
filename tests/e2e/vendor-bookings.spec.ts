import {
  addConfirmedBookingItem,
  bookingItemStatus,
  createListingWithStatus,
  createVendorFor,
  setVendorOnboarded,
} from "./db"
import { createVerifiedUser, expect, signInAndWait, test } from "./support"
import { randomUUID } from "node:crypto"

test("E2E-S6-01: a vendor sees its confirmed booking and marks it fulfilled", async ({
  page,
  request,
}) => {
  const vendorUser = await createVerifiedUser(request)
  const vendor = await createVendorFor(vendorUser.email, "APPROVED", {
    stripeAccountId: `acct_e2e_${randomUUID().slice(0, 8)}`,
  })
  await setVendorOnboarded(vendor.id)
  const title = `E2E Fulfil ${randomUUID().slice(0, 8)}`
  const listing = await createListingWithStatus(vendor.id, title, "PUBLISHED")
  const itemId = await addConfirmedBookingItem(listing.id)

  await signInAndWait(page, vendorUser.email, vendorUser.password)
  await page.goto("/vendor/bookings")

  await expect(page.getByText(title)).toBeVisible()
  await page.getByRole("button", { name: "Mark fulfilled" }).click()

  await expect(page.locator(`[data-status="FULFILLED"]`)).toBeVisible()
  expect(await bookingItemStatus(itemId)).toBe("FULFILLED")
})
