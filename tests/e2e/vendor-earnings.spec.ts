import { randomUUID } from "node:crypto"
import {
  addBookingForTourist,
  createListingWithStatus,
  createVendorFor,
  setVendorOnboarded,
} from "./db"
import { createVerifiedUser, expect, signInAndWait, test } from "./support"

test("E6-S2-02: a vendor sees the gross, commission and net of a paid sale on the earnings page", async ({
  page,
  request,
}) => {
  const vendorUser = await createVerifiedUser(request)
  const vendor = await createVendorFor(vendorUser.email, "APPROVED", {
    stripeAccountId: `acct_e2e_${randomUUID().slice(0, 8)}`,
  })
  await setVendorOnboarded(vendor.id)
  const listing = await createListingWithStatus(
    vendor.id,
    `E2E Earn Walk ${randomUUID().slice(0, 8)}`,
    "PUBLISHED"
  )

  // A confirmed £15.00 sale with £1.50 commission (the fixture's numbers).
  const tourist = await createVerifiedUser(request)
  await addBookingForTourist(listing.id, tourist.email)

  await signInAndWait(page, vendorUser.email, vendorUser.password)
  await page.goto("/vendor/earnings")

  await expect(page.getByRole("heading", { name: "All time" })).toBeVisible()
  await expect(page.getByText("£15.00").first()).toBeVisible()
  await expect(page.getByText("£1.50").first()).toBeVisible()
  await expect(page.getByText("£13.50").first()).toBeVisible()
})
