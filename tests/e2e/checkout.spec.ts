import { randomUUID } from "node:crypto"
import {
  addOpenSlot,
  createListingWithStatus,
  createVendorFor,
  setVendorOnboarded,
} from "./db"
import { createVerifiedUser, expect, signInAndWait, test } from "./support"

const unique = () => randomUUID().slice(0, 8)

test("E2E-01: a visitor adds a time, pays on the Stripe page, and the processing page shows the booking confirmed", async ({
  page,
  request,
}) => {
  const vendorUser = await createVerifiedUser(request)
  const vendor = await createVendorFor(vendorUser.email, "APPROVED", {
    stripeAccountId: `acct_e2e_${unique()}`,
  })
  await setVendorOnboarded(vendor.id)
  const title = `E2E Pay Walk ${unique()}`
  const listing = await createListingWithStatus(vendor.id, title, "PUBLISHED")
  await addOpenSlot(listing.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))

  const visitor = await createVerifiedUser(request)
  await signInAndWait(page, visitor.email, visitor.password)

  await page.goto(`/listings/${listing.slug}`)
  await page.getByRole("button", { name: "Add to cart" }).click()
  await expect(page.getByRole("status")).toContainText("Added.")

  await page.goto("/cart")
  await page.getByRole("button", { name: "Continue to payment" }).click()

  // The Stripe page (the development stand-in) lists the amount to pay.
  await expect(page.getByRole("link", { name: "Pay £15.00" })).toBeVisible()
  await page.getByRole("link", { name: "Pay £15.00" }).click()

  await expect(page.getByRole("status")).toContainText(
    "Your booking is confirmed"
  )
})

test("E2E-02: a visitor who cancels on the Stripe page is offered the payment again", async ({
  page,
  request,
}) => {
  const vendorUser = await createVerifiedUser(request)
  const vendor = await createVendorFor(vendorUser.email, "APPROVED", {
    stripeAccountId: `acct_e2e_${unique()}`,
  })
  await setVendorOnboarded(vendor.id)
  const title = `E2E Cancel Walk ${unique()}`
  const listing = await createListingWithStatus(vendor.id, title, "PUBLISHED")
  await addOpenSlot(listing.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))

  const visitor = await createVerifiedUser(request)
  await signInAndWait(page, visitor.email, visitor.password)

  await page.goto(`/listings/${listing.slug}`)
  await page.getByRole("button", { name: "Add to cart" }).click()
  await expect(page.getByRole("status")).toContainText("Added.")

  await page.goto("/cart")
  await page.getByRole("button", { name: "Continue to payment" }).click()
  await page.getByRole("link", { name: "Cancel and go back" }).click()

  await expect(page.getByText("Payment was not completed.")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Continue to payment" })
  ).toBeVisible()
})
