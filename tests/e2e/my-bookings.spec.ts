import { randomUUID } from "node:crypto"
import {
  addBookingForTourist,
  createListingWithStatus,
  createVendorFor,
  setVendorOnboarded,
} from "./db"
import { createVerifiedUser, expect, signInAndWait, test } from "./support"

test("E2E-S3-01: a visitor sees their own booking with its London time; another visitor does not", async ({
  page,
  request,
}) => {
  const vendorUser = await createVerifiedUser(request)
  const vendor = await createVendorFor(vendorUser.email, "APPROVED", {
    stripeAccountId: `acct_e2e_${randomUUID().slice(0, 8)}`,
  })
  await setVendorOnboarded(vendor.id)
  const title = `E2E My Walk ${randomUUID().slice(0, 8)}`
  const listing = await createListingWithStatus(vendor.id, title, "PUBLISHED")

  const owner = await createVerifiedUser(request)
  await addBookingForTourist(listing.id, owner.email)

  await signInAndWait(page, owner.email, owner.password)
  await page.goto("/account/bookings")
  await expect(page.getByText(title)).toBeVisible()
  await page.getByRole("link", { name: /Booking [0-9A-F]{8}/ }).click()
  await expect(
    page.getByText("Status: confirmed", { exact: false })
  ).toBeVisible()

  const other = await createVerifiedUser(request)
  await signInAndWait(page, other.email, other.password)
  await page.goto("/account/bookings")
  await expect(page.getByText("You have no bookings yet.")).toBeVisible()
})
