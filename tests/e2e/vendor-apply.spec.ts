import { randomUUID } from "node:crypto"
import type { Page } from "@playwright/test"
import {
  SEED,
  SEED_PASSWORD,
  countEmails,
  countEmailsMatching,
  linkIn,
  createVerifiedUser,
  expect,
  expectSignInRedirect,
  signInAndWait,
  signInViaUi,
  test,
  waitForEmail,
  waitForEmailMatching,
} from "./support"

const businessName = () => `E2E Apply ${randomUUID().slice(0, 8)}`

async function apply(page: Page, name: string, description = "Walking tours.") {
  await page.goto("/vendor/apply")
  await page.getByLabel("Business name").fill(name)
  await page.getByLabel(/^What do you offer/).fill(description)
  await page.getByRole("button", { name: "Submit application" }).click()
}

/** Signs the admin in, applies a decision to the named vendor, and signs out. */
async function adminDecides(
  page: Page,
  name: string,
  action: "Approve" | "Reject",
  reason?: string
) {
  await page.context().clearCookies()
  await signInAndWait(page, SEED.admin, SEED_PASSWORD)
  await page.goto("/admin/vendors?status=PENDING")
  await page.getByRole("link", { name }).click()
  if (reason) await page.getByLabel(/^Reason/).fill(reason)
  await page.getByRole("button", { name: action, exact: true }).click()
  await expect(
    page.locator('[data-slot="badge"][data-status]').first()
  ).not.toHaveAttribute("data-status", "PENDING")
  await page.context().clearCookies()
}

test("E2E-S4-01: someone applies from their profile and sees the application under review", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)
  const name = businessName()

  await signInAndWait(page, email, password)
  await page.goto("/account/profile")
  await page.getByRole("link", { name: "Become a vendor" }).click()
  await expect(page).toHaveURL(/\/vendor\/apply$/)
  await expect(page.getByLabel("Contact email (optional)")).toHaveAttribute(
    "type",
    "email"
  )
  await expect(page.getByText(`Leave blank to use ${email}`)).toBeVisible()

  // An empty application is explained, not sent.
  await page.getByRole("button", { name: "Submit application" }).click()
  await expect(page.getByText("Enter your business name")).toBeVisible()

  await page.getByLabel("Business name").fill(name)
  await page.getByRole("button", { name: "Submit application" }).click()

  await expect(
    page.getByRole("heading", { name: "Your application is under review" })
  ).toBeVisible()
  const card = page.getByTestId("application-card")
  await expect(card).toContainText(name)
  await expect(card).toContainText("Pending")
  await expect(page.getByLabel("Business name")).toHaveCount(0)

  // The administrator is told, once, and the email links to this application.
  const mentions = (m: { text?: string; html: string }) =>
    (m.text ?? m.html).includes(name)
  const notice = await waitForEmailMatching(
    SEED.admin,
    "vendor-application",
    mentions
  )
  expect(notice.subject).toBe(`New vendor application: ${name}`)
  expect(notice.text ?? notice.html).toContain(email)
  expect(
    await countEmailsMatching(SEED.admin, "vendor-application", mentions)
  ).toBe(1)

  // It sticks across a reload, and applying granted no access.
  await page.reload()
  await expect(page.getByTestId("application-card")).toContainText(name)
  expect((await page.goto("/vendor"))?.status()).toBe(404)
})

test("E2E-S4-02: an approved applicant gets the vendor dashboard and one email", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)
  const name = businessName()

  await signInAndWait(page, email, password)
  await apply(page, name)
  await expect(page.getByTestId("application-card")).toContainText("Pending")

  await adminDecides(page, name, "Approve")

  await signInAndWait(page, email, password)
  await page.goto("/vendor/apply")
  await expect(
    page.getByRole("heading", { name: "You're approved" })
  ).toBeVisible()
  await page.getByRole("link", { name: "Open your vendor dashboard" }).click()
  await expect(
    page.getByRole("heading", { name: "Vendor dashboard" })
  ).toBeVisible()

  await waitForEmail(email, "vendor-approved")
  expect(await countEmails(email, "vendor-approved")).toBe(1)
})

test("E2E-S4-03: a rejected applicant sees the reason and can apply again", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)
  const first = businessName()
  const second = businessName()

  await signInAndWait(page, email, password)
  await apply(page, first)
  await adminDecides(page, first, "Reject", "No trading licence")

  await signInAndWait(page, email, password)
  await page.goto("/vendor/apply")
  await expect(page.getByRole("heading", { name: "Apply again" })).toBeVisible()
  const card = page.getByTestId("application-card")
  await expect(card).toContainText(first)
  await expect(card).toContainText("Rejected")
  await expect(card).toContainText("Reason: No trading licence")

  await page.getByLabel("Business name").fill(second)
  await page.getByRole("button", { name: "Submit application" }).click()

  await expect(
    page.getByRole("heading", { name: "Your application is under review" })
  ).toBeVisible()
  await expect(page.getByTestId("application-card")).toContainText(second)
  // Still no access: only approval grants it.
  expect((await page.goto("/vendor"))?.status()).toBe(404)
})

test("E2E-S4-04: signed-out visitors are sent to sign-in and come back; an admin is told they cannot apply", async ({
  page,
}) => {
  await page.goto("/vendor/apply")
  await expectSignInRedirect(page, "/vendor/apply")
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()

  await page.getByLabel("Email").fill(SEED.admin)
  await page.getByLabel("Password").fill(SEED_PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page).toHaveURL(/\/vendor\/apply$/)
  await expect(
    page.getByRole("heading", { name: "Administrators can't apply" })
  ).toBeVisible()
  await expect(page.getByLabel("Business name")).toHaveCount(0)
})

test("E2E-S4-05: a rejected submission keeps what was typed", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)

  await signInViaUi(page, email, password)
  await page.waitForURL((url) => url.pathname !== "/sign-in")
  await page.goto("/vendor/apply")

  await page.getByLabel("Business name").fill("Thames Tours")
  await page.getByLabel("Contact email (optional)").fill("not-an-email")
  await page.getByRole("button", { name: "Submit application" }).click()

  await expect(page.getByText("Enter a valid email address")).toBeVisible()
  await expect(page.getByLabel("Business name")).toHaveValue("Thames Tours")
  await expect(page.getByLabel("Contact email (optional)")).toHaveValue(
    "not-an-email"
  )
})

test("E2E-S4-06: the administrator's email link opens that application, ready to decide", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)
  const name = businessName()

  await signInAndWait(page, email, password)
  await apply(page, name, "Guided walks along the river.")
  await expect(page.getByTestId("application-card")).toContainText("Pending")

  const notice = await waitForEmailMatching(
    SEED.admin,
    "vendor-application",
    (m) => (m.text ?? m.html).includes(name)
  )
  expect(notice.text ?? notice.html).toContain("Guided walks along the river.")

  await page.context().clearCookies()
  await signInAndWait(page, SEED.admin, SEED_PASSWORD)
  await page.goto(linkIn(notice))

  await expect(page.getByRole("heading", { name })).toBeVisible()
  await expect(
    page.locator('[data-slot="badge"][data-status="PENDING"]')
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Approve", exact: true })
  ).toBeVisible()
  await expect(
    page.locator('[data-audit-action="vendor.applied"]')
  ).toBeVisible()
})
