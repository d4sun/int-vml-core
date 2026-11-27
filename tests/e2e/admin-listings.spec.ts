import { randomUUID } from "node:crypto"
import {
  createPendingListing,
  createVendorFor,
  listingStatus,
  setVendorOnboarded,
} from "./db"
import {
  SEED,
  SEED_PASSWORD,
  createVerifiedUser,
  expect,
  signInAndWait,
  test,
  waitForEmailMatching,
} from "./support"

const unique = () => randomUUID().slice(0, 8)

test("E2E-03: an onboarded vendor's listing waits for review, an admin publishes it, and the vendor is told", async ({
  page,
  request,
}) => {
  const { email } = await createVerifiedUser(request)
  const vendor = await createVendorFor(email, "APPROVED")
  await setVendorOnboarded(vendor.id)

  const title = `E2E Publish ${unique()}`
  const listingId = await createPendingListing(vendor.id, title)

  await signInAndWait(page, SEED.admin, SEED_PASSWORD)
  await page.goto("/admin/listings")
  await page.getByRole("link", { name: title }).click()
  await expect(page).toHaveURL(`/admin/listings/${listingId}`)

  await page.getByRole("button", { name: "Approve and publish" }).click()

  await expect(page.getByText("This listing is published")).toBeVisible()
  expect(await listingStatus(listingId)).toBe("PUBLISHED")

  const mail = await waitForEmailMatching(
    email,
    "listing-approved",
    (message) => message.subject.includes(title)
  )
  expect(mail.html).toContain("/vendor/listings")
})

test("E2E-S9-03: a vendor that is not onboarded cannot be approved, and a rejection needs a reason the vendor then sees", async ({
  page,
  request,
}) => {
  const { email } = await createVerifiedUser(request)
  const vendor = await createVendorFor(email, "APPROVED")

  const title = `E2E Blocked ${unique()}`
  const listingId = await createPendingListing(vendor.id, title)

  await signInAndWait(page, SEED.admin, SEED_PASSWORD)
  await page.goto("/admin/listings")

  const row = page.locator(`[data-listing-id="${listingId}"]`)
  await expect(row).toContainText("Cannot approve")

  await page.goto(`/admin/listings/${listingId}`)
  await expect(
    page.getByRole("button", { name: "Approve and publish" })
  ).toBeDisabled()
  await expect(page.getByText("Approval is blocked")).toBeVisible()

  // Rejecting without a reason is refused on the field, and nothing changes.
  await page.getByRole("button", { name: "Reject" }).click()
  await expect(
    page.getByText("Give a reason to reject a listing")
  ).toBeVisible()
  expect(await listingStatus(listingId)).toBe("PENDING_REVIEW")

  const reason = "Add a clear description of the route"
  await page.getByLabel(/^Reason/).fill(reason)
  await page.getByRole("button", { name: "Reject" }).click()

  await expect(page.getByText("This listing is rejected")).toBeVisible()
  expect(await listingStatus(listingId)).toBe("REJECTED")

  const mail = await waitForEmailMatching(
    email,
    "listing-rejected",
    (message) => message.subject.includes(title)
  )
  expect(mail.text ?? mail.html).toContain(reason)
})
