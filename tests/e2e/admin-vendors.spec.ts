import type { Page } from "@playwright/test"
import { closeDb, createVendor } from "./db"
import {
  SEED,
  countEmails,
  linkIn,
  SEED_PASSWORD,
  expect,
  expectSignInRedirect,
  signInAndWait,
  test,
  waitForEmail,
} from "./support"

test.afterAll(closeDb)

const status = (page: Page, value: string) =>
  page.locator(`[data-slot="badge"][data-status="${value}"]`)

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true })

test("E2E-S8-01: an admin finds a pending vendor in the queue, approves it, and sees it change at once", async ({
  page,
}) => {
  const vendor = await createVendor("PENDING")

  await signInAndWait(page, SEED.admin, SEED_PASSWORD)
  await page.goto("/admin/vendors")

  await expect(page.getByRole("heading", { name: "Vendors" })).toBeVisible()
  await expect(page.getByRole("link", { name: /^Pending/ })).toHaveAttribute(
    "aria-current",
    "page"
  )

  const row = page.getByRole("row").filter({ hasText: vendor.name })
  await expect(row).toBeVisible()
  await expect(row.getByText(vendor.ownerName)).toBeVisible()

  await row.getByRole("link", { name: vendor.name }).click()
  await expect(page.getByRole("heading", { name: vendor.name })).toBeVisible()
  await expect(status(page, "PENDING")).toBeVisible()

  // Only the legal actions for a pending vendor are offered.
  await expect(button(page, "Approve")).toBeVisible()
  await expect(button(page, "Reject")).toBeVisible()
  await expect(button(page, "Suspend")).toHaveCount(0)
  await expect(button(page, "Reinstate")).toHaveCount(0)

  await button(page, "Approve").click()

  await expect(page.getByText("this vendor is now approved")).toBeVisible()

  // The owner is told, by exactly one email, with a link to their dashboard.
  const approved = await waitForEmail(vendor.ownerEmail, "vendor-approved")
  expect(approved.subject).toBe("Your vendor application has been approved")
  expect(linkIn(approved)).toMatch(/\/vendor$/)
  expect(await countEmails(vendor.ownerEmail, "vendor-approved")).toBe(1)
  await expect(status(page, "APPROVED")).toBeVisible()
  await expect(status(page, "PENDING")).toHaveCount(0)
  await expect(
    page.locator('[data-audit-action="vendor.approved"]')
  ).toContainText("pending → approved")
  await expect(button(page, "Approve")).toHaveCount(0)
  await expect(button(page, "Suspend")).toBeVisible()

  // It has left the pending queue and is now in the approved list.
  await page.goto("/admin/vendors")
  await expect(
    page.getByRole("row").filter({ hasText: vendor.name })
  ).toHaveCount(0)
  await page.goto("/admin/vendors?status=APPROVED")
  await expect(
    page.getByRole("row").filter({ hasText: vendor.name })
  ).toBeVisible()
})

test("E2E-S8-02: suspending needs a reason; a suspended vendor can be reinstated", async ({
  page,
}) => {
  const vendor = await createVendor("APPROVED")

  await signInAndWait(page, SEED.admin, SEED_PASSWORD)
  await page.goto(`/admin/vendors/${vendor.id}`)
  await expect(status(page, "APPROVED")).toBeVisible()

  // No reason: refused, and nothing changed.
  await button(page, "Suspend").click()
  await expect(
    page.getByText("Give a reason to suspend a vendor")
  ).toBeVisible()
  await expect(status(page, "APPROVED")).toBeVisible()
  expect(await countEmails(vendor.ownerEmail, "vendor-suspended")).toBe(0)

  await page.getByLabel(/^Reason/).fill("Chargeback spike")
  await button(page, "Suspend").click()

  await expect(page.getByText("this vendor is now suspended")).toBeVisible()
  await expect(status(page, "SUSPENDED")).toBeVisible()
  await expect(
    page.locator('[data-audit-action="vendor.suspended"]')
  ).toContainText("Chargeback spike")
  await expect(button(page, "Reinstate")).toBeVisible()
  await expect(button(page, "Suspend")).toHaveCount(0)

  const suspended = await waitForEmail(vendor.ownerEmail, "vendor-suspended")
  expect(suspended.text ?? suspended.html).toContain("Reason: Chargeback spike")

  await button(page, "Reinstate").click()
  await expect(status(page, "APPROVED")).toBeVisible()
  await waitForEmail(vendor.ownerEmail, "vendor-reinstated")
  await expect(page.locator("[data-audit-action]")).toHaveCount(2)
  expect(await countEmails(vendor.ownerEmail, "vendor-suspended")).toBe(1)
  expect(await countEmails(vendor.ownerEmail, "vendor-reinstated")).toBe(1)
})

test("E2E-S8-03: rejecting needs a reason and is final", async ({ page }) => {
  const vendor = await createVendor("PENDING")

  await signInAndWait(page, SEED.admin, SEED_PASSWORD)
  await page.goto(`/admin/vendors/${vendor.id}`)

  await button(page, "Reject").click()
  await expect(page.getByText("Give a reason to reject a vendor")).toBeVisible()
  await expect(status(page, "PENDING")).toBeVisible()
  expect(await countEmails(vendor.ownerEmail, "vendor-rejected")).toBe(0)

  await page.getByLabel(/^Reason/).fill("No trading licence")
  await button(page, "Reject").click()

  await expect(status(page, "REJECTED")).toBeVisible()
  const rejected = await waitForEmail(vendor.ownerEmail, "vendor-rejected")
  expect(rejected.text ?? rejected.html).toContain("Reason: No trading licence")
  expect(await countEmails(vendor.ownerEmail, "vendor-rejected")).toBe(1)
  await expect(page.getByText(/no further action is possible/)).toBeVisible()
  await expect(
    page.getByRole("button", { name: /Approve|Reject|Suspend|Reinstate/ })
  ).toHaveCount(0)
})

test("E2E-S8-04: only admins can see the queue or a vendor, and no vendor data leaks", async ({
  page,
}) => {
  const vendor = await createVendor("PENDING")

  // Signed out: sent to sign-in, and no vendor data in the page.
  await page.goto("/admin/vendors")
  await expectSignInRedirect(page, "/admin/vendors")
  await page.goto(`/admin/vendors/${vendor.id}`)
  await expectSignInRedirect(page, `/admin/vendors/${vendor.id}`)
  await page.goto("/admin/vendors?status=APPROVED")
  await expectSignInRedirect(page, "/admin/vendors?status=APPROVED")

  // A tourist and a vendor owner get a plain 404 and see nothing.
  for (const email of [SEED.tourist, SEED.owner]) {
    await page.context().clearCookies()
    await signInAndWait(page, email, SEED_PASSWORD)

    for (const path of ["/admin/vendors", `/admin/vendors/${vendor.id}`]) {
      const response = await page.goto(path)

      expect(response?.status(), `${email} ${path}`).toBe(404)
      await expect(page.getByText(vendor.name)).toHaveCount(0)
    }
  }
})

test("E2E-S8-05: an unknown vendor id is a 404 for an admin", async ({
  page,
}) => {
  await signInAndWait(page, SEED.admin, SEED_PASSWORD)

  const response = await page.goto("/admin/vendors/no-such-vendor")

  expect(response?.status()).toBe(404)
})

test("E2E-S8-06: the sign-in return path comes from the real URL, never from a client header", async ({
  request,
}) => {
  const response = await request.get("/admin/vendors", {
    headers: { "x-vml-request-path": "https://evil.example/phish" },
    maxRedirects: 0,
  })

  expect(response.status()).toBe(307)

  const location = new URL(response.headers().location!, "http://localhost")

  expect(location.pathname).toBe("/sign-in")
  expect(location.searchParams.get("next")).toBe("/admin/vendors")
})
