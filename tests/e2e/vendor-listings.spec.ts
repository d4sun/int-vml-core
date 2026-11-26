import { randomUUID } from "node:crypto"
import type { Page } from "@playwright/test"
import { addVendorMember, createVendorFor } from "./db"
import { createVerifiedUser, expect, signInAndWait, test } from "./support"

// A valid 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
)
const png = (name: string) => ({ name, mimeType: "image/png", buffer: PNG })

async function newListing(page: Page, title: string) {
  await page.goto("/vendor/listings/new")
  await page.getByLabel("Title").fill(title)
  await page.getByLabel("Category").selectOption({ label: "Tours" })
  await page.getByRole("button", { name: "Create draft" }).click()
  await expect(page).toHaveURL(/\/vendor\/listings\/[0-9a-f-]{36}$/)
}

test("E2E-S5-01: a vendor creates a listing, adds and orders pictures, and submits it for review", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)

  await createVendorFor(email, "APPROVED")
  await signInAndWait(page, email, password)

  const title = `E2E Walk ${randomUUID().slice(0, 6)}`

  await newListing(page, title)
  await expect(
    page.locator('[data-slot="badge"][data-status="DRAFT"]')
  ).toBeVisible()

  // Edit the details.
  await page
    .getByLabel("Description (optional)")
    .fill("A guided walk by the river.")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Saved.")).toBeVisible()

  // Add two pictures.
  await page
    .getByLabel("Add pictures")
    .setInputFiles([png("a.png"), png("b.png")])
  await expect(page.getByTestId("gallery-item")).toHaveCount(2)

  // Move the second picture first, then remove the (new) second.
  const before = await page
    .getByTestId("gallery-item")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-image-id")))

  await page.getByRole("button", { name: "Move picture 2 earlier" }).click()
  await expect
    .poll(async () =>
      page
        .getByTestId("gallery-item")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-image-id")))
    )
    .toEqual([before[1], before[0]])

  await page.getByRole("button", { name: "Remove picture 2" }).click()
  await expect(page.getByTestId("gallery-item")).toHaveCount(1)

  // The picture really loads from storage.
  const src = await page
    .getByTestId("gallery-item")
    .locator("img")
    .getAttribute("src")
  const served = await request.get(src!)

  expect(served.status()).toBe(200)
  expect(served.headers()["content-type"]).toBe("image/png")

  // Submit it.
  await page.getByRole("button", { name: "Submit for review" }).click()
  await expect(
    page.locator('[data-slot="badge"][data-status="PENDING_REVIEW"]')
  ).toBeVisible()
  await expect(page.getByTestId("status-help")).toContainText("can't be edited")
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(
    0
  )
  await expect(
    page.getByRole("button", { name: "Submit for review" })
  ).toHaveCount(0)
  await expect(page.getByLabel("Add pictures")).toHaveCount(0)

  // It shows in the list with its status.
  await page.goto("/vendor/listings")
  await expect(
    page.getByTestId("listing-list").locator("li", { hasText: title })
  ).toContainText("Pending review")
})

test("E2E-S5-02: bad input is explained on the field and nothing is created", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)

  await createVendorFor(email, "APPROVED")
  await signInAndWait(page, email, password)
  await page.goto("/vendor/listings/new")
  await page.getByLabel("Title").fill("ab")
  await page.getByLabel("Category").selectOption({ label: "Tours" })
  await page.getByLabel("Latitude (optional)").fill("95")
  await page.getByRole("button", { name: "Create draft" }).click()

  await expect(
    page.getByText("Title must be at least 3 characters")
  ).toBeVisible()
  await expect(
    page.getByText("Give both latitude and longitude, or neither")
  ).toBeVisible()
  await expect(page).toHaveURL(/\/vendor\/listings\/new$/)
})

test("E2E-S5-03: a picture of the wrong type is refused and a vendor cannot open someone else's listing", async ({
  page,
  request,
}) => {
  const mine = await createVerifiedUser(request)
  const rival = await createVerifiedUser(request)

  await createVendorFor(mine.email, "APPROVED")
  await createVendorFor(rival.email, "APPROVED")
  await signInAndWait(page, mine.email, mine.password)
  await newListing(page, `Mine ${randomUUID().slice(0, 6)}`)

  const listingUrl = page.url()

  await page.getByLabel("Add pictures").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  })
  await expect(
    page.getByRole("region", { name: "Pictures" }).getByRole("alert")
  ).toContainText("JPEG, PNG or WebP")
  await expect(page.getByTestId("gallery-item")).toHaveCount(0)

  await page.context().clearCookies()
  await signInAndWait(page, rival.email, rival.password)

  const response = await page.goto(listingUrl)

  expect(response?.status()).toBe(404)
})

test("E2E-S5-04: staff can work on listings, and a vendor that is not approved cannot add any", async ({
  page,
  request,
}) => {
  const owner = await createVerifiedUser(request)
  const staff = await createVerifiedUser(request)
  const vendor = await createVendorFor(owner.email, "APPROVED")

  await addVendorMember(vendor.id, staff.email, "STAFF")
  await signInAndWait(page, staff.email, staff.password)
  await newListing(page, `Staff ${randomUUID().slice(0, 6)}`)

  const suspended = await createVerifiedUser(request)

  await page.context().clearCookies()
  await createVendorFor(suspended.email, "SUSPENDED")
  await signInAndWait(page, suspended.email, suspended.password)
  await page.goto("/vendor/listings")
  await expect(page.getByTestId("listings-not-approved")).toBeVisible()
  await expect(page.getByRole("link", { name: "New listing" })).toHaveCount(0)
})

test("E2E-S5-05: a visitor is sent to sign in and a non-vendor gets a 404", async ({
  page,
  request,
}) => {
  expect((await page.goto("/vendor/listings"))?.url()).toContain("/sign-in")

  const { email, password } = await createVerifiedUser(request)

  await signInAndWait(page, email, password)
  expect((await page.goto("/vendor/listings"))?.status()).toBe(404)
})
