import { addVendorMember, createVendorFor, vendorPayoutState } from "./db"
import { createVerifiedUser, expect, signInAndWait, test } from "./support"

const status = (page: import("@playwright/test").Page) =>
  page.getByTestId("payout-status")

test("E2E-S4-07: an approved owner sets up payouts end to end and the page shows ready", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)
  const vendor = await createVendorFor(email, "APPROVED")

  await signInAndWait(page, email, password)
  await page.goto("/vendor/payouts/setup")

  await expect(status(page)).toHaveAttribute("data-state", "NOT_STARTED")
  await expect(page.getByText(vendor.name)).toBeVisible()
  await page.getByRole("button", { name: "Set up payouts" }).click()

  // The stand-in for Stripe's hosted page (the fake adapter is in use).
  await expect(page).toHaveURL(/\/api\/dev\/stripe-fake\/onboard\?/)
  await page.getByRole("button", { name: "Complete onboarding" }).click()

  await expect(page).toHaveURL(/\/vendor\/payouts\/setup\?stripe=return$/)
  await expect(status(page)).toHaveAttribute("data-state", "READY")
  await expect(
    page.getByRole("button", { name: /onboarding|Set up payouts/ })
  ).toHaveCount(0)

  const saved = await vendorPayoutState(vendor.id)

  expect(saved.stripeOnboardingComplete).toBe(true)
  expect(saved.stripeAccountId).toMatch(/^acct_fake_/)
})

test("E2E-S4-08: an incomplete submission shows what is still needed, and continuing finishes it", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)
  const vendor = await createVendorFor(email, "APPROVED")

  await signInAndWait(page, email, password)
  await page.goto("/vendor/payouts/setup")
  await page.getByRole("button", { name: "Set up payouts" }).click()
  await page
    .getByRole("button", { name: "Submit but leave something outstanding" })
    .click()

  await expect(status(page)).toHaveAttribute("data-state", "ACTION_NEEDED")
  await expect(page.getByTestId("payout-needs")).toContainText(
    "Bank account for payouts"
  )
  expect((await vendorPayoutState(vendor.id)).stripeOnboardingComplete).toBe(
    false
  )

  await page.getByRole("button", { name: "Continue onboarding" }).click()
  await page.getByRole("button", { name: "Complete onboarding" }).click()

  await expect(status(page)).toHaveAttribute("data-state", "READY")
})

test("E2E-S4-09: leaving Stripe without finishing keeps the page honest, and a second start reuses the account", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)
  const vendor = await createVendorFor(email, "APPROVED")

  await signInAndWait(page, email, password)
  await page.goto("/vendor/payouts/setup")
  await page.getByRole("button", { name: "Set up payouts" }).click()
  await page.getByRole("button", { name: "Leave without finishing" }).click()

  await expect(status(page)).toHaveAttribute("data-state", "ACTION_NEEDED")
  await expect(page.getByTestId("payout-needs")).toHaveCount(0)

  const first = (await vendorPayoutState(vendor.id)).stripeAccountId

  await page.getByRole("button", { name: "Continue onboarding" }).click()
  await page.getByRole("button", { name: "Complete onboarding" }).click()
  await expect(status(page)).toHaveAttribute("data-state", "READY")
  expect((await vendorPayoutState(vendor.id)).stripeAccountId).toBe(first)
})

test("E2E-S4-10: staff can see the status but not start setup", async ({
  page,
  request,
}) => {
  const owner = await createVerifiedUser(request)
  const staff = await createVerifiedUser(request)
  const vendor = await createVendorFor(owner.email, "APPROVED")

  await addVendorMember(vendor.id, staff.email, "STAFF")
  await signInAndWait(page, staff.email, staff.password)
  await page.goto("/vendor/payouts/setup")

  await expect(status(page)).toHaveAttribute("data-state", "NOT_STARTED")
  await expect(page.getByTestId("payout-owner-only")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Set up payouts" })
  ).toHaveCount(0)
})

test("E2E-S4-11: a suspended vendor sees it is not available and cannot start", async ({
  page,
  request,
}) => {
  const { email, password } = await createVerifiedUser(request)

  await createVendorFor(email, "SUSPENDED")
  await signInAndWait(page, email, password)
  await page.goto("/vendor/payouts/setup")

  await expect(status(page)).toHaveAttribute("data-state", "NOT_APPROVED")
  await expect(
    page.getByRole("button", { name: "Set up payouts" })
  ).toHaveCount(0)
})

test("E2E-S4-12: someone who is not a vendor gets a 404, and a visitor is sent to sign in", async ({
  page,
  request,
}) => {
  const visitor = await page.goto("/vendor/payouts/setup")

  expect(visitor?.url()).toContain("/sign-in")

  const { email, password } = await createVerifiedUser(request)

  await signInAndWait(page, email, password)

  const response = await page.goto("/vendor/payouts/setup")

  expect(response?.status()).toBe(404)
})

test("the stand-in Stripe page will not redirect anywhere but the payout setup page", async ({
  request,
}) => {
  const bad = await request.post("/api/dev/stripe-fake/onboard", {
    form: {
      account: "acct_x",
      return: "https://evil.example/vendor/payouts/setup",
      outcome: "cancel",
    },
    maxRedirects: 0,
  })

  expect(bad.status()).toBe(400)
})
