import { randomUUID } from "node:crypto"
import {
  createListingWithStatus,
  createVendorFor,
  setVendorOnboarded,
} from "./db"
import { createVerifiedUser, expect, test } from "./support"

const unique = () => randomUUID().slice(0, 8)

test("E2E-S1-01: a published listing is found on /explore, its page has real prices and structured data, and a draft is not found", async ({
  page,
  request,
}) => {
  const { email } = await createVerifiedUser(request)
  const vendor = await createVendorFor(email, "APPROVED")
  await setVendorOnboarded(vendor.id)

  const title = `E2E Public Walk ${unique()}`
  const live = await createListingWithStatus(vendor.id, title, "PUBLISHED")
  const draft = await createListingWithStatus(
    vendor.id,
    `E2E Draft ${unique()}`,
    "DRAFT"
  )

  // Found on the explore page by its title.
  await page.goto(`/explore?q=${encodeURIComponent(title)}`)
  await expect(page.getByTestId("explore-results")).toContainText(title)
  await expect(page.getByTestId("explore-results")).toContainText("From £15.00")

  // Its page renders with the real price and structured data.
  await page.goto(`/listings/${live.slug}`)
  await expect(
    page.getByRole("heading", { level: 1, name: title })
  ).toBeVisible()
  await expect(page.getByText("Morning walk")).toBeVisible()

  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .textContent()
  const data = JSON.parse(jsonLd ?? "{}") as {
    "@type"?: string
    name?: string
    offers?: { price?: string }[]
  }
  expect(data["@type"]).toBe("TouristAttraction")
  expect(data.name).toBe(title)
  expect(data.offers?.[0]?.price).toBe("15.00")

  // A draft has no public page.
  const response = await page.goto(`/listings/${draft.slug}`)
  expect(response?.status()).toBe(404)
})

test("E2E-S1-02: the filters narrow the results through the form, and the map shows the places", async ({
  page,
  request,
}) => {
  const { email } = await createVerifiedUser(request)
  const vendor = await createVendorFor(email, "APPROVED")
  await setVendorOnboarded(vendor.id)

  const token = unique()
  const first = `First ${token} walk`
  const second = `Second ${token} walk`
  // Both are priced at £15.00 by the helper, so a £10 maximum leaves nothing.
  await createListingWithStatus(vendor.id, first, "PUBLISHED")
  await createListingWithStatus(vendor.id, second, "PUBLISHED")

  await page.goto(`/explore?q=${encodeURIComponent(token)}`)
  await expect(page.getByTestId("explore-results")).toContainText(first)
  await expect(page.getByTestId("explore-results")).toContainText(second)

  // Set a maximum price of £10 through the form.
  await page.getByLabel("Maximum price in pounds").fill("10")
  await page.getByRole("button", { name: "Apply filters" }).click()

  await expect(page).toHaveURL(/maxPounds=10/)
  await expect(page.getByTestId("explore-count")).toContainText("0 places")

  // The map is drawn with its controls.
  await page.goto(`/explore?q=${encodeURIComponent(token)}`)
  await expect(page.locator(".leaflet-container")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Search this area" })
  ).toBeVisible()
})
