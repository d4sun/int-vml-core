import { randomUUID } from "node:crypto"
import {
  createListingWithStatus,
  createVendorFor,
  setVendorOnboarded,
} from "./db"
import { createVerifiedUser, expect, signInAndWait, test } from "./support"

const unique = () => randomUUID().slice(0, 8)

test("E2E-S2-01: a visitor creates a trip, saves a listing to it, and sees it in the trip; a signed-out visitor is asked to sign in", async ({
  page,
  request,
}) => {
  // The listing belongs to a vendor; the visitor is a separate account.
  const vendorUser = await createVerifiedUser(request)
  const vendor = await createVendorFor(vendorUser.email, "APPROVED")
  await setVendorOnboarded(vendor.id)
  const title = `E2E Trip Walk ${unique()}`
  const listing = await createListingWithStatus(vendor.id, title, "PUBLISHED")

  // Signed out: the listing page asks to sign in, and the trips page redirects.
  await page.goto(`/listings/${listing.slug}`)
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible()
  await page.goto("/trips")
  await expect(page).toHaveURL(/\/sign-in/)

  // Signed in: create a trip, then save the listing into it.
  const visitor = await createVerifiedUser(request)
  await signInAndWait(page, visitor.email, visitor.password)

  const tripName = `E2E Summer ${unique()}`
  await page.goto("/trips")
  await page.getByLabel("New trip").fill(tripName)
  await page.getByRole("button", { name: "Create trip" }).click()
  await expect(page.getByRole("link", { name: tripName })).toBeVisible()

  await page.goto(`/listings/${listing.slug}`)
  await page.getByLabel("Trip").selectOption({ label: tripName })
  await page.getByRole("button", { name: "Save to trip" }).click()
  await expect(page.getByRole("status")).toContainText(`Saved to ${tripName}.`)

  // The trip shows the place, in order.
  await page.goto("/trips")
  await page.getByRole("link", { name: tripName }).click()
  await expect(page.getByRole("link", { name: title })).toBeVisible()
  await expect(page.getByText("Stop 1")).toBeVisible()
})
